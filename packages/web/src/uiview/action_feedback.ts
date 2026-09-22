/** Accessible feedback shared by descriptor-originated mutation controls. */
export function actionFeedback(button: HTMLButtonElement, allowed: boolean) {
  const message = document.createElement("span");
  message.className = "mer-action-feedback";
  const id = `mer-action-feedback-${++feedbackId}`;
  message.id = id;
  button.setAttribute("aria-describedby", id);
  button.setAttribute("aria-disabled", String(!allowed));
  message.textContent = allowed ? "" : "Unavailable: this action is not permitted.";
  let pending = false;
  return {
    message,
    async run(invoke: () => Promise<unknown>) {
      if (pending) return;
      pending = true;
      button.setAttribute("aria-busy", "true");
      message.textContent = "";
      delete button.dataset.error;
      button.removeAttribute("title");
      try {
        await invoke();
        message.setAttribute("role", "status");
        message.textContent = "Completed.";
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        button.dataset.error = reason;
        button.title = reason;
        message.setAttribute("role", "alert");
        message.textContent = reason;
      } finally {
        pending = false;
        button.removeAttribute("aria-busy");
      }
    },
  };
}

let feedbackId = 0;
