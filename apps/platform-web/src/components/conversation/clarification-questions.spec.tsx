import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClarificationQuestions } from "./clarification-questions"

afterEach(cleanup)

describe("the planner's questions", () => {
  it("asks every question and answers them in one submission", async () => {
    const onSubmit = vi.fn()
    render(
      <ClarificationQuestions
        questions={[
          { id: "q1", question: "Which inbox should this watch?" },
          { id: "q2", question: "Who approves a refund?" },
        ]}
        onSubmit={onSubmit}
      />,
    )

    const submit = screen.getByRole("button", { name: "Answer and continue" })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    await userEvent.type(screen.getByLabelText("Which inbox should this watch?"), "support@acme.test")
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(screen.getByLabelText("Who approves a refund?"), " the finance lead ")
    expect((submit as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith({
      q1: "support@acme.test",
      q2: "the finance lead",
    })
  })

  it("lets an optional question go unanswered", async () => {
    const onSubmit = vi.fn()
    render(
      <ClarificationQuestions
        questions={[
          { id: "q1", question: "Which inbox should this watch?" },
          { id: "q2", question: "Anything else?", required: false },
        ]}
        onSubmit={onSubmit}
      />,
    )

    await userEvent.type(screen.getByLabelText("Which inbox should this watch?"), "support@acme.test")
    await userEvent.click(screen.getByRole("button", { name: "Answer and continue" }))

    expect(onSubmit).toHaveBeenCalledWith({ q1: "support@acme.test" })
  })

  it("cannot be submitted twice while the answer is in flight", async () => {
    const onSubmit = vi.fn()
    render(
      <ClarificationQuestions
        questions={[{ id: "q1", question: "Which inbox should this watch?" }]}
        onSubmit={onSubmit}
        pending
      />,
    )

    expect((screen.getByRole("button", { name: /Answer and continue/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText("Which inbox should this watch?") as HTMLInputElement).disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
