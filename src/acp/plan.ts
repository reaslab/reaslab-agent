import type { Todo } from "../session/todo"

type ACPPlanStatus = "pending" | "in_progress" | "completed"
type ACPPlanPriority = "high" | "medium" | "low"

function toPlanPriority(priority: string): ACPPlanPriority {
  if (priority === "high" || priority === "medium" || priority === "low") {
    return priority
  }

  return "medium"
}

function toPlanStatus(status: string): ACPPlanStatus {
  if (status === "pending" || status === "in_progress" || status === "completed") {
    return status
  }

  if (status === "cancelled") {
    return "completed"
  }

  return "pending"
}

export function todoToPlanEntries(todos: Todo.Info[]) {
  return todos.map((todo) => ({
    content: todo.content,
    priority: toPlanPriority(todo.priority),
    status: toPlanStatus(todo.status),
  }))
}
