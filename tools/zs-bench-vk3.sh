#!/bin/sh
MODEL=/models/LFM2.5-2.6B-Q4_K_M.gguf

echo "== mem =="
head -3 /proc/meminfo
echo "== start server =="
/app/llama-server -m $MODEL --host 127.0.0.1 --port 8080 -ngl 99 -c 512 -np 1 -t 4 --no-webui > /tmp/srv.log 2>&1 &
PID=$!

READY=0
i=0
while [ $i -lt 60 ]; do
  sleep 2
  if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 $PID 2>/dev/null; then echo "[server process died]"; break; fi
  i=$((i+1))
done

echo "== server log (head 40) =="
head -40 /tmp/srv.log
echo "== device lines =="
grep -iE "vulkan|device|backend|offload|model loaded|load time" /tmp/srv.log | head -25

if [ "$READY" = "1" ]; then
  echo "== short gen =="
  curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' \
    -d '{"model":"m","messages":[{"role":"user","content":"用一句话解释什么是显存。"}],"max_tokens":48,"temperature":0}' | tr -d '\0' | tail -c 700
  echo ""
  echo "== READY OK =="
else
  echo "== NOT READY =="
  tail -20 /tmp/srv.log
fi
kill $PID 2>/dev/null
echo "== end =="
