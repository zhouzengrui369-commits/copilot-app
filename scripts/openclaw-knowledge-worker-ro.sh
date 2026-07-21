#!/bin/sh
set -eu

REPO="/Users/njx/openclaw/copilot"
TASK_DIR="$REPO/tasks/openclaw/20260629-copilot-knowledge-mirror"
MIRROR_SKILL="/Users/njx/.openclaw/skills/copilot-note-mirror"
SRC_ROOT="/Users/njx/openclaw_data/memory/knowledge/notes"
NAS_ROOT="/Volumes/南极熊/07知识库/copilot_knowledge_mirror"
SMOKE_ROOT="/tmp/openclaw-knowledge-mirror-smoke"

cd "$REPO"

case "${1:-}" in
  canary)
    pwd
    git status --short -- apps/server/src/workbenchV11.ts apps/server/src/index.ts apps/server/src/yuanbaoSync.ts tasks/openclaw/20260629-copilot-knowledge-mirror
    test -d "$SRC_ROOT" && echo "SRC_OK $SRC_ROOT" || echo "SRC_MISSING $SRC_ROOT"
    test -d "/Volumes/南极熊" && echo "NAS_MOUNTED /Volumes/南极熊" || echo "NAS_NOT_MOUNTED /Volumes/南极熊"
    test -f "$MIRROR_SKILL/scripts/mirror_knowledge.py" && echo "MIRROR_SCRIPT_OK" || echo "MIRROR_SCRIPT_MISSING"
    ;;
  task)
    sed -n '1,220p' "$TASK_DIR/TASK.md"
    ;;
  result)
    sed -n '1,260p' "$TASK_DIR/RESULT.md"
    ;;
  evidence)
    sed -n '1,280p' "$TASK_DIR/EVIDENCE.md"
    ;;
  changed-files)
    git status --short -- apps/server/src/workbenchV11.ts apps/server/src/index.ts apps/server/src/yuanbaoSync.ts scripts/openclaw-knowledge-worker-ro.sh scripts/knowledge-mirror-live-test.mjs scripts/knowledge-mirror-cron-config.mjs tasks/openclaw/20260629-copilot-knowledge-mirror tasks/openclaw/20260630-knowledge-mirror-continuation
    ;;
  dry-run)
    python3 "$MIRROR_SKILL/scripts/initial_migrate_to_nas.py" --dry-run
    ;;
  apply-real)
    python3 "$MIRROR_SKILL/scripts/initial_migrate_to_nas.py" --apply
    mkdir -p "$NAS_ROOT"
    cat > "$NAS_ROOT/MIRROR_RULES.md" <<'RULES'
# copilot_knowledge_mirror 规则

- workspace 权威：`/Users/njx/openclaw_data/memory/knowledge/notes/`
- NAS 派生：`/Volumes/南极熊/07知识库/copilot_knowledge_mirror/notes/`
- 镜像范围：daily, calendar, voice_raw, mobile_audio, openclaw, worker_runs
- 不镜像：wiki, inbox, archive, index, reports, knowledge_index, knowledge_graph, nas-embed, extracted_text, ima_sync, obsidian 等非白名单目录
- 去重：source_hash 已存在且目标文件存在则 skip
- 冲突：目标文件存在但 source_hash 不同则追加 `_<hash8>.md`
- 删除：默认不删除 NAS 端；除非显式 `--prune`
- NAS 离线：主 Workbench 添加笔记链路不失败，镜像记录为 vault_unmounted
RULES
    cat > "$NAS_ROOT/MIGRATION.md" <<'MIGRATION'
# 首次迁移记录

首次迁移由 OpenClaw 受控 wrapper 执行：

```bash
/Users/njx/openclaw/copilot/scripts/openclaw-knowledge-worker-ro.sh apply-real
```

该目录是 Workbench notes 的 NAS 派生镜像，不是源数据。请不要在 NAS 端反向编辑后覆盖源。
MIGRATION
    ;;
  apply-real-quiet)
    mkdir -p "$REPO/tasks/openclaw/20260630-knowledge-mirror-continuation"
    python3 "$MIRROR_SKILL/scripts/initial_migrate_to_nas.py" --apply > "$REPO/tasks/openclaw/20260630-knowledge-mirror-continuation/apply-real.log" 2>&1
    mkdir -p "$NAS_ROOT"
    cat > "$NAS_ROOT/MIRROR_RULES.md" <<'RULES'
# copilot_knowledge_mirror 规则

- workspace 权威：`/Users/njx/openclaw_data/memory/knowledge/notes/`
- NAS 派生：`/Volumes/南极熊/07知识库/copilot_knowledge_mirror/notes/`
- 镜像范围：daily, calendar, voice_raw, mobile_audio, openclaw, worker_runs
- 不镜像：wiki, inbox, archive, index, reports, knowledge_index, knowledge_graph, nas-embed, extracted_text, ima_sync, obsidian 等非白名单目录
- 去重：source_hash 已存在且目标文件存在则 skip
- 冲突：目标文件存在但 source_hash 不同则追加 `_<hash8>.md`
- 删除：默认不删除 NAS 端；除非显式 `--prune`
- NAS 离线：主 Workbench 添加笔记链路不失败，镜像记录为 vault_unmounted
RULES
    cat > "$NAS_ROOT/MIGRATION.md" <<'MIGRATION'
# 首次迁移记录

首次迁移由 OpenClaw 受控 wrapper 执行：

```bash
/Users/njx/openclaw/copilot/scripts/openclaw-knowledge-worker-ro.sh apply-real-quiet
```

该目录是 Workbench notes 的 NAS 派生镜像，不是源数据。请不要在 NAS 端反向编辑后覆盖源。
MIGRATION
    tail -40 "$REPO/tasks/openclaw/20260630-knowledge-mirror-continuation/apply-real.log"
    ;;
  cron-mirror)
    python3 "$MIRROR_SKILL/scripts/mirror_knowledge.py" --scope notes --quiet
    ;;
  evidence-real)
    echo "=== source ==="
    find "$SRC_ROOT" \( -path "$SRC_ROOT/daily/*" -o -path "$SRC_ROOT/calendar/*" -o -path "$SRC_ROOT/voice_raw/*" -o -path "$SRC_ROOT/mobile_audio/*" -o -path "$SRC_ROOT/openclaw/*" -o -path "$SRC_ROOT/worker_runs/*" \) -type f -name '*.md' | wc -l | tr -d ' '
    du -sh "$SRC_ROOT" 2>/dev/null || true
    echo "=== nas ==="
    test -d "$NAS_ROOT" && find "$NAS_ROOT/notes" -type f -name '*.md' | wc -l | tr -d ' ' || echo 0
    test -d "$NAS_ROOT" && du -sh "$NAS_ROOT" || true
    test -f "$NAS_ROOT/.copilot-mirror-manifest.json" && python3 -c "import json; p='$NAS_ROOT/.copilot-mirror-manifest.json'; d=json.load(open(p)); print('manifest_files', len(d.get('files',{}))); print('last_run', d.get('last_run',''))"
    test -f "$NAS_ROOT/MIRROR_RULES.md" && echo "MIRROR_RULES_OK"
    test -f "$NAS_ROOT/MIGRATION.md" && echo "MIGRATION_OK"
    ;;
  live-note)
    node scripts/knowledge-mirror-live-test.mjs
    ;;
  workbench-health)
    node -e "const base=process.env.OPENCLAW_WORKBENCH_URL||'http://127.0.0.1:38888'; const started=Date.now(); try { const r=await fetch(base+'/api/health'); const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={rawText:text}}; console.log(JSON.stringify({ok:r.ok,status:r.status,base,ms:Date.now()-started,data}, null, 2)); if(!r.ok) process.exit(1); } catch (err) { console.error(JSON.stringify({ok:false,base,error:err.message,ms:Date.now()-started}, null, 2)); process.exit(1); }"
    ;;
  yuanbao-dry-run)
    node -e "const base=process.env.OPENCLAW_WORKBENCH_URL||'http://127.0.0.1:38888'; const password=process.env.OPENCLAW_WORKBENCH_PASSWORD||''; if(!password) throw new Error('OPENCLAW_WORKBENCH_PASSWORD_REQUIRED'); const req=async(p,o={})=>{const r=await fetch(base+p,{...o,headers:{'Content-Type':'application/json',...(o.headers||{})}}); const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{}}catch{d={rawText:t}}; return {r,d};}; const auth=await req('/api/auth/login',{method:'POST',body:JSON.stringify({password})}); if(!auth.r.ok) throw new Error('auth_failed:'+JSON.stringify(auth.d)); const cookie=(auth.r.headers.get('set-cookie')||'').split(';')[0]; const st=await req('/api/yuanbao/sync/status',{headers:{Cookie:cookie}}); const run=await req('/api/yuanbao/sync/run?dryRun=true',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({dryRun:true,maxFiles:20})}); console.log(JSON.stringify({status:{code:st.r.status,data:st.d}, dryRun:{code:run.r.status,data:run.d}}, null, 2)); if(!run.r.ok) process.exit(1);"
    ;;
  yuanbao-today-status)
    node -e "const fs=require('fs'); const path=require('path'); const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}); const today=fmt.format(new Date()); const dayOf=(d)=>fmt.format(new Date(d)); const roots=[process.env.YUANBAO_AAC_ROOT,'/Users/njx/Library/Containers/com.tencent.yuanbao/Data/Library/Global/Voice','/Users/njx/Library/Application Support/com.tencent.yuanbao/Voice','/Users/njx/Library/Application Support/腾讯元宝/Voice'].filter(Boolean); const dataPaths=['/Users/njx/openclaw_data/copilot/data/yuanbao-sync-state.json','/Users/njx/openclaw_data/openclaw_workbench/data/yuanbao-sync-state.json']; const notesRoot='/Users/njx/openclaw_data/memory/knowledge/notes'; const nasRoot='/Volumes/南极熊/07知识库/copilot_knowledge_mirror/notes'; const exts=new Set(['.aac','.m4a','.wav','.mp3']); const walk=(root,pred,out=[])=>{if(!root||!fs.existsSync(root))return out; for(const e of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,e.name); if(e.isDirectory())walk(p,pred,out); else if(e.isFile()&&pred(p))out.push(p);} return out;}; const rootStatus=roots.map(p=>({path:p,exists:fs.existsSync(p)})); const activeRoot=(rootStatus.find(r=>r.exists)||rootStatus[0]||{}).path||''; const audioToday=walk(activeRoot,p=>exts.has(path.extname(p).toLowerCase())&&dayOf(fs.statSync(p).mtime)===today).map(p=>({path:p,size:fs.statSync(p).size,mtime:fs.statSync(p).mtime.toISOString()})); const statePath=dataPaths.find(p=>fs.existsSync(p))||dataPaths[0]; let state={processed:{},lastRun:'',lastRunStatus:'missing'}; if(fs.existsSync(statePath)){try{state=JSON.parse(fs.readFileSync(statePath,'utf8'));}catch(e){state={processed:{},lastRun:'',lastRunStatus:'parse_error',error:e.message};}} const processed=Object.values(state.processed||{}); const stateToday=processed.filter(e=>dayOf(e.importedAt||e.mtime||0)===today||dayOf(e.mtime||0)===today); const importedToday=stateToday.filter(e=>e.status==='imported'); const failedToday=stateToday.filter(e=>['failed','asr_unavailable','transcript_empty'].includes(e.status)); const textHasYuanbao=(t)=>/元宝录音|auto-yuanbao-sync|yuanbao_sync_v1/.test(t); const notePred=p=>p.endsWith('.md')&&(dayOf(fs.statSync(p).mtime)===today||path.basename(p).includes(today.replaceAll('-',''))); const notesToday=walk(notesRoot,notePred).filter(p=>textHasYuanbao(fs.readFileSync(p,'utf8'))); const mirrorsToday=walk(nasRoot,notePred).filter(p=>textHasYuanbao(fs.readFileSync(p,'utf8'))); const verdict=audioToday.length===0?'NO_SOURCE_AUDIO_FOUND_TODAY':(failedToday.length===0&&importedToday.length>=audioToday.length?'ALL_DISCOVERED_AUDIO_IMPORTED':'NOT_ALL_DISCOVERED_AUDIO_IMPORTED'); console.log(JSON.stringify({ok:true,today,sourceRoots:rootStatus,activeRoot,audioTodayCount:audioToday.length,audioToday,state:{path:statePath,exists:fs.existsSync(statePath),lastRun:state.lastRun,lastRunStatus:state.lastRunStatus,processedCount:processed.length,importedTodayCount:importedToday.length,failedTodayCount:failedToday.length,importedToday,failedToday},notesTodayCount:notesToday.length,notesToday,mirrorsTodayCount:mirrorsToday.length,mirrorsToday,verdict},null,2));"
    ;;
  yuanbao-locate-today-audio)
    node scripts/yuanbao-today-audio-locate.mjs
    ;;
  yuanbao-mdfind-today-audio)
    /usr/bin/mdfind -onlyin /Users/njx '((kMDItemFSName == "*.aac"cd) || (kMDItemFSName == "*.m4a"cd) || (kMDItemFSName == "*.mp3"cd) || (kMDItemFSName == "*.wav"cd) || (kMDItemFSName == "*.caf"cd) || (kMDItemFSName == "*.opus"cd) || (kMDItemFSName == "*.amr"cd)) && ((kMDItemFSCreationDate >= $time.today) || (kMDItemFSContentChangeDate >= $time.today))' | head -200
    ;;
  yuanbao-find-today-audio)
    /usr/bin/find /Users/njx/Library /Users/njx/Downloads /Users/njx/Documents /Users/njx/Desktop /Users/njx/Movies /Users/njx/Music /Users/njx/openclaw_data \( -name node_modules -o -name .git -o -name DerivedData \) -prune -o -type f \( -iname '*.aac' -o -iname '*.m4a' -o -iname '*.mp3' -o -iname '*.wav' -o -iname '*.caf' -o -iname '*.opus' -o -iname '*.amr' \) -mtime -1 -print 2>/dev/null | head -200
    ;;
  yuanbao-import-visible)
    node scripts/yuanbao-import-visible-transcripts.mjs
    ;;
  yuanbao-backfill-calendar-daily)
    node scripts/yuanbao-backfill-calendar-daily.mjs
    ;;
  yuanbao-upgrade-calendar-notes)
    node scripts/yuanbao-upgrade-calendar-notes.mjs
    ;;
  cron-configure)
    node scripts/knowledge-mirror-cron-config.mjs
    ;;
  cron-status)
    node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/Users/njx/.openclaw/cron/jobs.json','utf8')); const jobs=d.jobs||[]; const pick=id=>jobs.find(j=>j.id===id); console.log(JSON.stringify({autoVoice:pick('auto-voice-note-yuanbao-batch'), copilotDailyMirror:pick('copilot-daily-mirror')}, null, 2));"
    ;;
  smoke-tmp)
    rm -rf "$SMOKE_ROOT"
    mkdir -p "$SMOKE_ROOT/src/daily" "$SMOKE_ROOT/src/voice_raw/2026-06" "$SMOKE_ROOT/nas"
    printf '%s\n' '---' 'title: "smoke daily"' 'tags: [smoke]' '---' '' 'same body' > "$SMOKE_ROOT/src/daily/a.md"
    cp "$SMOKE_ROOT/src/daily/a.md" "$SMOKE_ROOT/src/daily/a-copy.md"
    printf '%s\n' '---' 'title: "voice raw"' '---' '' 'voice body' > "$SMOKE_ROOT/src/voice_raw/2026-06/v.md"
    COPILOT_NOTES_SRC="$SMOKE_ROOT/src" COPILOT_MIRROR_NAS_ROOT="$SMOKE_ROOT/nas" python3 "$MIRROR_SKILL/scripts/mirror_knowledge.py" --quiet
    COPILOT_NOTES_SRC="$SMOKE_ROOT/src" COPILOT_MIRROR_NAS_ROOT="$SMOKE_ROOT/nas" python3 "$MIRROR_SKILL/scripts/mirror_knowledge.py" --quiet
    find "$SMOKE_ROOT/nas" -type f | sort
    ;;
  server-check)
    npm run check --workspace @openclaw-workbench/server
    ;;
  server-build)
    npm run build --workspace @openclaw-workbench/server
    ;;
  *)
    cat <<'USAGE' >&2
Usage:
  openclaw-knowledge-worker-ro.sh canary
  openclaw-knowledge-worker-ro.sh task
  openclaw-knowledge-worker-ro.sh result
  openclaw-knowledge-worker-ro.sh evidence
  openclaw-knowledge-worker-ro.sh changed-files
  openclaw-knowledge-worker-ro.sh dry-run
  openclaw-knowledge-worker-ro.sh apply-real
  openclaw-knowledge-worker-ro.sh apply-real-quiet
  openclaw-knowledge-worker-ro.sh cron-mirror
  openclaw-knowledge-worker-ro.sh evidence-real
  openclaw-knowledge-worker-ro.sh live-note
  openclaw-knowledge-worker-ro.sh workbench-health
  openclaw-knowledge-worker-ro.sh yuanbao-dry-run
  openclaw-knowledge-worker-ro.sh yuanbao-today-status
  openclaw-knowledge-worker-ro.sh yuanbao-locate-today-audio
  openclaw-knowledge-worker-ro.sh yuanbao-mdfind-today-audio
  openclaw-knowledge-worker-ro.sh yuanbao-find-today-audio
  openclaw-knowledge-worker-ro.sh yuanbao-import-visible
  openclaw-knowledge-worker-ro.sh yuanbao-backfill-calendar-daily
  openclaw-knowledge-worker-ro.sh yuanbao-upgrade-calendar-notes
  openclaw-knowledge-worker-ro.sh cron-configure
  openclaw-knowledge-worker-ro.sh cron-status
  openclaw-knowledge-worker-ro.sh smoke-tmp
  openclaw-knowledge-worker-ro.sh server-check
  openclaw-knowledge-worker-ro.sh server-build
USAGE
    exit 2
    ;;
esac
