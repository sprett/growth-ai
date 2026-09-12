import { describe, expect, it } from "vitest";
import {
  parseFileEditReply,
  rankCandidateFiles,
  selectUiSourceFiles,
  stripPlannedFileContent,
} from "@/lib/pipeline/repo-edit";

const STUDENT_APP_FILES = [
  "README.md",
  "frontend/package.json",
  "frontend/node_modules/react/index.tsx",
  "frontend/Student_App/frontend/src/utils/streak.ts",
  "frontend/src/AuthPanel.tsx",
  "frontend/src/App.tsx",
  "frontend/src/pages/loghours.tsx",
  "frontend/src/pages/dashboard.tsx",
  "frontend/src/pages/subjects.tsx",
  "frontend/src/index.css",
  "frontend/src/db/logs.ts",
];

describe("selectUiSourceFiles", () => {
  it("keeps UI source files and drops nested copies, node_modules, and non-UI paths", () => {
    expect(selectUiSourceFiles(STUDENT_APP_FILES)).toEqual([
      "frontend/src/App.tsx",
      "frontend/src/AuthPanel.tsx",
      "frontend/src/index.css",
      "frontend/src/pages/dashboard.tsx",
      "frontend/src/pages/loghours.tsx",
      "frontend/src/pages/subjects.tsx",
    ]);
  });
});

describe("rankCandidateFiles", () => {
  it("puts log-hours ahead of AuthPanel for a session timer experiment", () => {
    const ranked = rankCandidateFiles(STUDENT_APP_FILES, {
      element: "session_timer",
      promptText: "Change the session timer copy on the log hours screen to Start session",
    });
    expect(ranked[0]).toBe("frontend/src/pages/loghours.tsx");
    expect(ranked).not.toContain("frontend/Student_App/frontend/src/utils/streak.ts");
    expect(ranked).not.toContain("frontend/src/AuthPanel.tsx");
  });

  it("still returns UI files even when the element name matches none of them", () => {
    const ranked = rankCandidateFiles(STUDENT_APP_FILES, {
      element: "session_timer",
      promptText: "Make the timer say Keep going",
    });
    expect(ranked).toContain("frontend/src/pages/loghours.tsx");
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("does not default a generic CTA copy change to AuthPanel", () => {
    const ranked = rankCandidateFiles(STUDENT_APP_FILES, {
      element: "cta_button",
      promptText: "On the log hours screen, change the primary CTA from Logg økt to Start session",
    });
    expect(ranked[0]).toBe("frontend/src/pages/loghours.tsx");
    expect(ranked).not.toContain("frontend/src/AuthPanel.tsx");
  });

  it("keeps AuthPanel for an actual signup request", () => {
    const ranked = rankCandidateFiles(STUDENT_APP_FILES, {
      element: "signup_cta",
      promptText: "Change the signup CTA copy to Start free trial",
    });
    expect(ranked[0]).toBe("frontend/src/AuthPanel.tsx");
  });
});

describe("parseFileEditReply", () => {
  const allowed = ["frontend/src/pages/loghours.tsx", "frontend/src/AuthPanel.tsx"];

  it("accepts a valid edit of an allowed file", () => {
    expect(
      parseFileEditReply(
        {
          path: "frontend/src/pages/loghours.tsx",
          before: "Logg økt",
          content: "export default function LogHours() { return <button>Start session</button>; }\n",
        },
        allowed,
      ),
    ).toEqual({
      path: "frontend/src/pages/loghours.tsx",
      before: "Logg økt",
      content: "export default function LogHours() { return <button>Start session</button>; }\n",
    });
  });

  it("rejects a path that was not in the candidate set", () => {
    expect(() =>
      parseFileEditReply(
        { path: "frontend/src/hack.ts", before: "x", content: "y" },
        allowed,
      ),
    ).toThrow(/not one of the candidate files/);
  });

  it("rejects empty content", () => {
    expect(() =>
      parseFileEditReply(
        { path: "frontend/src/pages/loghours.tsx", before: "x", content: "  " },
        allowed,
      ),
    ).toThrow(/content/);
  });
});

describe("stripPlannedFileContent", () => {
  it("drops file_content but keeps the path and hypothesis fields", () => {
    expect(
      stripPlannedFileContent({
        element: "session_timer",
        file_path: "frontend/src/pages/loghours.tsx",
        file_content: "export default function LogHours() {}",
      }),
    ).toEqual({
      element: "session_timer",
      file_path: "frontend/src/pages/loghours.tsx",
    });
  });
});
