"use client";

/**
 * THROWAWAY visual preview — not part of the implementation plan.
 * Shows the new ChatGPT/Claude-style chat layout (Task 11) with hardcoded
 * sample data, so the layout can be reviewed before Tasks 6/7/10 (which the
 * real component depends on) are built. Delete this file once Task 11 lands.
 */

import { Check, Flag, ImagePlus, Loader2, Send, X } from "lucide-react";
import { useState } from "react";

type StepStatus = "revealing" | "done" | "error";

type StepCard = {
  icon: typeof Check;
  label: string;
  status: StepStatus;
  message: string;
};

type FlagState = "idle" | "pending" | "done" | "error";

type RunTurn = {
  kind: "run";
  id: string;
  steps: StepCard[];
  canCreateFlag: boolean;
  flagState: FlagState;
  flagMessage: string | null;
};

type UserTurn = {
  kind: "user";
  id: string;
  text: string;
  hasImage: boolean;
};

type Turn = UserTurn | RunTurn;

const SAMPLE_TURNS: Turn[] = [
  {
    kind: "user",
    id: "u1",
    text: "Make the signup CTA say \"Kom i gang\" and turn it green.",
    hasImage: true,
  },
  {
    kind: "run",
    id: "r1",
    steps: [
      {
        icon: Check,
        label: "Parse request",
        status: "done",
        message: 'Parsed as cta_button/copy → "Kom i gang"',
      },
      {
        icon: Check,
        label: "Generate diff",
        status: "done",
        message: "Prepared frontend/src/AuthPanel.tsx with cta_button/copy set to \"Kom i gang\".",
      },
      {
        icon: Check,
        label: "Open PR",
        status: "done",
        message: "Opened https://github.com/denizsaether/Student_App/pull/101",
      },
    ],
    canCreateFlag: true,
    flagState: "idle",
    flagMessage: null,
  },
  {
    kind: "user",
    id: "u2",
    text: "Actually, try a different headline instead.",
    hasImage: false,
  },
  {
    kind: "run",
    id: "r2",
    steps: [
      {
        icon: Check,
        label: "Parse request",
        status: "done",
        message: 'Parsed as headline/copy → "Bli med gratis"',
      },
      {
        icon: Check,
        label: "Generate diff",
        status: "done",
        message: "Prepared frontend/src/AuthPanel.tsx with headline/copy set to \"Bli med gratis\".",
      },
      {
        icon: Check,
        label: "Open PR",
        status: "done",
        message: "Opened https://github.com/denizsaether/Student_App/pull/102",
      },
    ],
    canCreateFlag: true,
    flagState: "done",
    flagMessage: "Created PostHog flag growth-agent-a1b2c3d4",
  },
  {
    kind: "user",
    id: "u3",
    text: "Change the tagline color to purple.",
    hasImage: false,
  },
  {
    kind: "run",
    id: "r3",
    steps: [
      {
        icon: Check,
        label: "Parse request",
        status: "done",
        message: "Parsed as tagline/color → error",
      },
      {
        icon: X,
        label: "Generate diff",
        status: "error",
        message: "color changes are only supported on cta_button",
      },
    ],
    canCreateFlag: false,
    flagState: "idle",
    flagMessage: null,
  },
  {
    kind: "user",
    id: "u4",
    text: "Make the button copy say \"Start today\".",
    hasImage: false,
  },
  {
    kind: "run",
    id: "r4",
    steps: [
      {
        icon: Loader2,
        label: "Parse request",
        status: "revealing",
        message: "",
      },
    ],
    canCreateFlag: false,
    flagState: "idle",
    flagMessage: null,
  },
];

export default function PreviewChatPage() {
  const [draft, setDraft] = useState("");

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <p className="m-0 mb-6 border border-dashed border-rule bg-ticket px-3 py-2 font-mono text-[11px] text-mute">
        Preview only — hardcoded sample data, not wired to the real pipeline yet.
      </p>

      <div className="flex min-h-[70vh] flex-col">
        <div className="flex flex-1 flex-col gap-3 pb-4">
          {SAMPLE_TURNS.map((turn) =>
            turn.kind === "user" ? (
              <div key={turn.id} className="flex justify-end">
                <div className="max-w-[75%] rounded-2xl bg-ink px-3.5 py-2 text-ticket">
                  <p className="m-0 text-[14px] leading-snug">{turn.text}</p>
                  {turn.hasImage ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <div className="h-11 w-11 rounded-md bg-ticket/30" />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="flex flex-col gap-1.5">
                {turn.steps.map((card, index) => (
                  <div
                    key={`${turn.id}-${index}`}
                    className="flex items-center gap-2.5 rounded-lg border border-rule/40 bg-ticket/60 px-2.5 py-1.5"
                  >
                    <span
                      className={
                        "grid size-5 shrink-0 place-items-center rounded-full border " +
                        (card.status === "error"
                          ? "border-[#C23A2B] text-[#C23A2B]"
                          : card.status === "done"
                            ? "border-ink bg-ink text-ticket"
                            : "border-rule text-mute")
                      }
                    >
                      {card.status === "revealing" ? (
                        <Loader2 className="size-2.5 animate-spin" strokeWidth={2} />
                      ) : card.status === "done" ? (
                        <Check className="size-2.5" strokeWidth={2.5} />
                      ) : (
                        <X className="size-2.5" strokeWidth={2.5} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 flex items-center gap-1 font-mono text-[9px] tracking-[0.08em] text-mute uppercase">
                        <card.icon className="size-2.5" strokeWidth={1.75} />
                        {card.label}
                      </p>
                      <p className="m-0 truncate text-[12.5px] leading-snug">
                        {card.status === "revealing" ? "Working…" : card.message}
                      </p>
                    </div>
                  </div>
                ))}
                {turn.canCreateFlag ? (
                  turn.flagState === "done" ? (
                    <div className="flex items-center gap-2 rounded-lg border border-rule/40 bg-ticket/60 px-2.5 py-1.5 text-[12.5px]">
                      <Flag className="size-3 shrink-0" strokeWidth={1.75} />
                      {turn.flagMessage}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 font-display text-[12.5px] font-bold text-ticket transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Flag className="size-3" strokeWidth={1.75} />
                      Create flag now
                    </button>
                  )
                ) : null}
              </div>
            ),
          )}
        </div>

        <form className="sticky bottom-0 bg-transparent pt-2" onSubmit={(e) => e.preventDefault()}>
          <div className="flex items-end gap-1 rounded-full border border-rule bg-ticket px-1.5 py-1">
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-full text-mute transition hover:text-ink"
              aria-label="Attach images"
            >
              <ImagePlus className="size-4" strokeWidth={1.75} />
            </button>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
              placeholder="I want to try a different CTA copy on the signup screen…"
              className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-ticket transition disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
