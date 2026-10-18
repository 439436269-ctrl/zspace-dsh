#!/bin/sh
# Foreground run, output goes straight to container stdout so a SIGKILL still
# leaves the Vulkan enumeration lines in the docker log.
MODEL=/models/LFM2.5-2.6B-Q4_K_M.gguf
echo "== mem before =="
head -3 /proc/meminfo
echo "== launching (foreground) =="
/app/llama-server -m $MODEL --host 127.0.0.1 --port 8080 -ngl 99 -c 256 -np 1 -t 4 --no-webui
echo "== exited rc=$? =="
