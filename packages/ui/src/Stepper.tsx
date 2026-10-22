import { Check } from "lucide-react";

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
  const currentIndex = steps.findIndex((s) => s.key === currentKey);

  return (
    <div className="stepper-v2">
      <div className="stepper-progress">
        <div
          className="stepper-progress-fill"
          style={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
        />
      </div>
      <div className="stepper-steps">
        {steps.map((step, i) => {
          const isDone = doneKeys.includes(step.key);
          const isActive = step.key === currentKey;
          const status = isActive ? "active" : isDone ? "done" : "";
          return (
            <div className={["stepper-step", status].filter(Boolean).join(" ")} key={step.key}>
              <div className="stepper-step-circle">
                {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
              </div>
              <div className="stepper-step-label">{step.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
