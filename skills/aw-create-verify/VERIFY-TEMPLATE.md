---
name: verify-<app>
description: "Start, drive and observe <app>, the repo's real <kind of app>, to gather evidence that a behaviour works. Use to prove an acceptance criterion on the running app, and when /aw-verify asks for this repo's verify skill."
---

# Verify <app>

Start <app>, drive it the way a user does, observe what it does, and clean up. Written by `/aw-create-verify` from the repo; every command names its source, and every `file:line` citation quotes the text it cites, checked against that file. A result counts only when it was observed in the run that reports it: never infer one from the code or the tests.

## Start

<The command that runs the app, from the repo root, and where it comes from (file and line). The environment it needs: each variable, with where the user keeps its value, never the value of a secret. The services it depends on and how to start them. Check the port first, where the app has one, and, when it is held, apply Diagnose's fix for a port in use. Whether it runs in the background, and how to keep its output. How it records the process identity of each process it starts, the process id with its command line or start time, read from the live process, and the ports this run took. Diagnose and Drive use those ports.>

## Diagnose

<How to tell the app is up and healthy: a health URL and the answer it gives, a log line, a version command. How long to wait, and how often to check. Where the logs go. The usual failures, each with its symptom and its fix: a port in use, a missing variable, a service that is down. The fix for a port in use leaves the process holding it alone: report what holds it and stop, or use another port where the app allows one.>

## Drive

<How to act on the app as a user does: the base URL and a request in the form to copy, the binary and its arguments, or the browser driver and how to open a page. How to set up the state a journey starts from (sign in, seed a record), through the app's own interface where it has one.>

## Observe

<What counts as evidence, by kind of behaviour: a response's status and body, a command's output and exit code, a screenshot (how to take it; the caller decides where to save it), a log line. Quote what was observed; never paraphrase it into a pass.>

## Clean up

<How to stop everything Start started: compare each recorded process identity with the live process and signal only on a match; on a mismatch, signal nothing and report it. The check and the signal use the same kind of process id: in Git Bash `$!` is an MSYS PID, and `taskkill` expects a Windows PID, which `/proc/<pid>/winpid` gives. How to check that nothing Start started is left running and no port this run took is still held. How to reset the state a run changed, such as a database or files it wrote. Clean up after every run, including one that failed.>

## Feature map

| Feature | Entry point | Drive | Observe | Code |
| --- | --- | --- | --- | --- |
| <What a user can do> | <Route, command or screen> | <The request, command or clicks> | <What the result looks like when it works> | <The files it lives in> |

## Smoke journey

<The shortest end-to-end run that proves the skill works: Start, Diagnose until healthy, drive one feature from the map, observe its expected result, Clean up. Run it to check the skill still works after the app changes.>

1. <Step, with its command.>
2. <…>
