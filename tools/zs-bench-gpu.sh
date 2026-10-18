#!/bin/sh
# One-shot bench: GPU (Vulkan, -ngl 99) then CPU (-ngl 0) on the same model.
MODEL=/models/LFM2.5-2.6B-Q4_K_M.gguf
APP=/app

echo "== env =="
command -v curl || echo NO_CURL
ls $APP | grep -E '^(llama-|rpc-)' || true
ls /usr/share/vulkan/icd.d 2>/dev/null | head -3

P=""
i=0
while [ $i -lt 120 ]; do
  P="$P人工智能正在改变我们的世界，算力与显存是其中最关键的变量之一。"
  i=$((i+1))
done

trial() {
  NGL=$1
  TAG=$2
  echo ""
  echo "===== $TAG : -ngl $NGL ====="
  $APP/llama-server -m $MODEL --host 127.0.0.1 --port 8080 -ngl $NGL -c 4096 -np 1 -t 4 --no-webui > /tmp/srv_$TAG.log 2>&1 &
  PID=$!
  i=0
  while [ $i -lt 90 ]; do
    sleep 2
    if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then break; fi
    i=$((i+1))
  done
  echo "-- device/backend lines --"
  grep -iE "vulkan|found [0-9]+ .*device|ggml_backend|no usable|n_gpu_layers|offloaded|model loaded|load time" /tmp/srv_$TAG.log | head -20
  echo "-- short gen (48 tok) --"
  curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' \
    -d '{"model":"m","messages":[{"role":"user","content":"用一句话解释什么是显存。"}],"max_tokens":48,"temperature":0}' | tr -d '\0' | tail -c 700
  echo ""
  echo "-- long prefill (~2000 tok) --"
  curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' \
    -d "{\"model\":\"m\",\"messages\":[{\"role\":\"user\",\"content\":\"$P\n\n请用一句话总结。\"}],\"max_tokens\":32,\"temperature\":0}" | tr -d '\0' | tail -c 900
  echo ""
  kill $PID 2>/dev/null
  wait $PID 2>/dev/null
  sleep 3
}

trial 99 vulkan
trial 0 cpu
echo "== DONE =="
