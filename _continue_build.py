# -*- coding: utf-8 -*-
# משגר המשך אוטונומי ל-cheder-v3. מריץ claude headless (בלי חלון), חלק-אחר-חלק,
# עד קובץ _BUILD_DONE או עד 8 איטרציות. מופעל ע"י Scheduled Task ב-17:00.
import subprocess, os, sys, time, datetime

CREATE_NO_WINDOW = 0x08000000
ROOT = r"C:\projects\cheder-v3"
LOG = os.path.join(ROOT, "_continue_build.log")
PROMPT_FILE = os.path.join(ROOT, "_continue_prompt.txt")
DONE = os.path.join(ROOT, "_BUILD_DONE")
CLAUDE_EXE = r"C:\openclaw-app\node_modules\@anthropic-ai\claude-code\bin\claude.exe"

def log(m):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {m}"
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def main():
    log("===== continuation launcher START =====")
    if not os.path.exists(CLAUDE_EXE):
        log(f"claude.exe not found at {CLAUDE_EXE} — abort."); return
    for i in range(1, 9):
        if os.path.exists(DONE):
            log("_BUILD_DONE exists — all parts complete. stopping."); break
        log(f"--- iteration {i}/8: invoking claude (headless) ---")
        try:
            with open(PROMPT_FILE, "r", encoding="utf-8") as pf:
                r = subprocess.run(
                    [CLAUDE_EXE, "--dangerously-skip-permissions", "-p"],
                    cwd=ROOT, stdin=pf,
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    creationflags=CREATE_NO_WINDOW, timeout=60 * 90,
                )
            log(f"iteration {i} returncode={r.returncode}")
            if r.stdout: log("STDOUT tail:\n" + r.stdout[-2000:])
            if r.stderr: log("STDERR tail:\n" + r.stderr[-1000:])
            if r.returncode != 0:
                log("non-zero returncode — stopping loop (probably token limit or error)."); break
        except subprocess.TimeoutExpired:
            log(f"iteration {i} TIMEOUT (90m) — stopping."); break
        except Exception as e:
            log(f"iteration {i} EXCEPTION: {e}"); break
        time.sleep(15)
    log("===== launcher END =====")

if __name__ == "__main__":
    main()
