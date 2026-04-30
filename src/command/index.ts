import { BusEvent } from "@/bus/bus-event"
import type { WorkspaceID } from "@/control-plane/schema"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Log } from "../util/log"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

export namespace Command {
  const log = Log.create({ service: "command" })

  type State = {
    commands: Record<string, Info>
  }

  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string) {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  function fromSkill(skill: Skill.Info): Info {
    return {
      name: skill.name,
      description: skill.description,
      source: "skill",
      get template() {
        return skill.content
      },
      hints: [],
    }
  }

  export type Scope = {
    workspaceID?: WorkspaceID
    sessionID?: SessionID
  }

  export interface Interface {
    readonly get: (name: string, scope?: Scope) => Effect.Effect<Info | undefined>
    readonly list: (scope?: Scope) => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@reaslab-agent/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = Config.get() as any
        const commands: Record<string, Info> = {}

        commands[Default.INIT] = {
          name: Default.INIT,
          description: "create/update REASLAB.md",
          source: "command",
          get template() {
            return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
          },
          hints: hints(PROMPT_INITIALIZE),
        }
        commands[Default.REVIEW] = {
          name: Default.REVIEW,
          description: "review changes [commit|branch|pr], defaults to uncommitted",
          source: "command",
          get template() {
            return PROMPT_REVIEW.replace("${path}", ctx.worktree)
          },
          subtask: true,
          hints: hints(PROMPT_REVIEW),
        }

        for (const [name, command] of Object.entries(cfg.command ?? {}) as [string, any][]) {
          commands[name] = {
            name,
            agent: command.agent,
            model: command.model,
            description: command.description,
            source: "command",
            get template() {
              return command.template
            },
            subtask: command.subtask,
            hints: hints(command.template),
          }
        }

        for (const [name, prompt] of Object.entries(yield* Effect.promise(() => MCP.prompts()))) {
          commands[name] = {
            name,
            source: "mcp",
            description: prompt.description,
            get template() {
              return new Promise<string>(async (resolve, reject) => {
                const template = await MCP.getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                ).catch(reject)
                resolve(
                  template?.messages
                    .map((message) => (message.content.type === "text" ? message.content.text : ""))
                    .join("\n") || "",
                )
              })
            },
            hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
          }
        }

        for (const skill of yield* Effect.promise(() => Skill.all())) {
          if (commands[skill.name]) continue
          commands[skill.name] = {
            name: skill.name,
            description: skill.description,
            source: "skill",
            get template() {
              return skill.content
            },
            hints: [],
          }
        }

        return {
          commands,
        }
      })

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string, scope?: Scope) {
        const state = yield* InstanceState.get(cache)
        const command = state.commands[name]
        if (command) return command
        if (!scope?.workspaceID && !scope?.sessionID) return
        const skill = yield* Effect.promise(() => Skill.runtimeGet(name, scope))
        if (!skill) return
        return fromSkill(skill)
      })

      const list = Effect.fn("Command.list")(function* (scope?: Scope) {
        const state = yield* InstanceState.get(cache)
        const commands = { ...state.commands }
        if (!scope?.workspaceID && !scope?.sessionID) {
          return Object.values(commands)
        }
        for (const skill of yield* Effect.promise(() => Skill.runtimeAll(scope))) {
          if (commands[skill.name]) continue
          commands[skill.name] = fromSkill(skill)
        }
        return Object.values(commands)
      })

      return Service.of({ get, list })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function get(name: string, scope?: Scope) {
    return runPromise((svc) => svc.get(name, scope))
  }

  export async function list(scope?: Scope) {
    return runPromise((svc) => svc.list(scope))
  }
}
