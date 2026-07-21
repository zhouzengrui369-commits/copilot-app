import fs from 'node:fs';
const audioPath = process.env.OPENCLAW_TRANSCRIPTION_AUDIO_PATH || process.argv.at(-1) || '';
if (!audioPath || !fs.existsSync(audioPath)) {
  console.error(JSON.stringify({ error: 'audio_path_missing', audioPath }));
  process.exit(2);
}
console.log(JSON.stringify({ text: `${process.env.OPENCLAW_TRANSCRIPTION_LANGUAGE || 'zh-CN'} 本地转写成功：请把这句话发送给主智能体。` }));