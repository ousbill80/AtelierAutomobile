export interface StepperStep {
  key: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  currentKey: string;
  doneKeys: string[];
}

export function Stepper({ steps, currentKey, doneKeys }: StepperProps) {
  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const status =
          step.key === currentKey ? "active" : doneKeys.includes(step.key) ? "done" : "";
        return (
          <div className={["step", status].filter(Boolean).join(" ")} key={step.key}>
            <div className="step-circle">{status === "done" ? "✓" : i + 1}</div>
            <div className="step-label">{step.label}</div>
            {i < steps.length - 1 ? <div className="step-line" /> : null}
          </div>
        );
      })}
    </div>
  );
}
