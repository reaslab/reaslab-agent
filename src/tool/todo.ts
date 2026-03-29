import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

function summarizeTodos(todos: Todo.Info[]) {
  const summary = {
    total: todos.length,
    inProgress: todos.filter((todo) => todo.status === "in_progress").length,
    pending: todos.filter((todo) => todo.status === "pending").length,
    completed: todos.filter((todo) => todo.status === "completed").length,
    cancelled: todos.filter((todo) => todo.status === "cancelled").length,
  }
  const openCount = todos.filter(
    (todo) => todo.status !== "completed" && todo.status !== "cancelled",
  ).length

  // Format for frontend parsing: "1. [status] description"
  const lines = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)

  return {
    output: lines.join("\n"),
    summary,
    openCount,
  }
}

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    await Todo.update({
      sessionID: ctx.sessionID,
      todos: params.todos,
    })
    const result = summarizeTodos(params.todos)
    return {
      title: `${result.openCount} ${result.openCount === 1 ? "todo" : "todos"}`,
      output: result.output,
      metadata: {
        todos: params.todos,
        summary: result.summary,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    const result = summarizeTodos(todos)
    return {
      title: `${result.openCount} ${result.openCount === 1 ? "todo" : "todos"}`,
      metadata: {
        todos,
        summary: result.summary,
      },
      output: result.output,
    }
  },
})
