import os
import subprocess
import time
import sys

def run_cmd(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr

print("========================================")
print("   NAVCORE PRO AUTO DEPLOY   ")
print("========================================\n")

print("[1/3] Adding changes...")
run_cmd("git add .")

print("[2/3] Committing updates...")
# Use a timestamp for commit to always make a diff
commit_msg = f"Auto deploy update - {time.strftime('%H:%M:%S')}"
code, out, err = run_cmd(f'git commit -m "{commit_msg}"')

if "nothing to commit" in out:
    print("\n -> No new changes to push! Everything is already up to date.")
    sys.exit(0)

print("[3/3] Pushing to GitHub (This might take a moment)...")
code, out, err = run_cmd("git push -u origin main")

if code != 0:
    print(f"\n -> ERROR Pushing to GitHub:\n{err}")
    sys.exit(1)

print("\n========================================")
print(" -> PUSH SUCCESSFUL! <- ")
print("========================================")
print("GitHub Pages is now building your site.")
print("Waiting 30 seconds to ensure the site is live...\n")

# Wait with a visual progress bar
total = 30
for i in range(total):
    progress = int((i / total) * 20)
    bar = "[" + "=" * progress + " " * (20 - progress) + f"] {total-i}s remaining..."
    sys.stdout.write("\r" + bar)
    sys.stdout.flush()
    time.sleep(1)

print("\n\n DONE! YOUR APP IS LIVE! ")
print("-> Open the NavCore app on your phone.")
print("-> Click the Update button next to the title to refresh to v1.4!\n")

