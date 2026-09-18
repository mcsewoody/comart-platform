function lcChunk(text, max) {
  var out = [], buf = '', lines = String(text).split('\n');
  function flush(sep) { if (buf.length) { out.push([buf, sep]); buf = ''; } }
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    while (ln.length > max) {
      var cut = -1;
      for (var j = Math.min(max, ln.length) - 1; j > max * 0.5; j--) {
        if ('\u3002\uff01\uff1f\uff1b.!?;'.indexOf(ln.charAt(j)) >= 0) { cut = j + 1; break; }
      }
      if (cut < 0) cut = max;
      flush('');
      out.push([ln.slice(0, cut), '']);
      ln = ln.slice(cut);
    }
    if (buf.length && buf.length + 1 + ln.length > max) flush('\n');
    buf = buf.length ? (buf + '\n' + ln) : ln;
  }
  flush('');
  return out;
}

// ── 測試：拼回去必須與原文一模一樣，且每段不超過上限 ──
function join(cs){ return cs.map(c => c[0] + c[1]).join(''); }
let fail = 0, n = 0;
function check(name, text, max) {
  n++;
  const cs = lcChunk(text, max);
  const back = join(cs);
  const tooLong = cs.filter(c => c[0].length > max);
  if (back !== text) { fail++; console.log('❌ ' + name + '：拼回去不等於原文'); console.log('   原:', JSON.stringify(text.slice(0,80))); console.log('   回:', JSON.stringify(back.slice(0,80))); }
  else if (tooLong.length) { fail++; console.log('❌ ' + name + '：有 ' + tooLong.length + ' 段超過上限 (' + tooLong[0][0].length + ' > ' + max + ')'); }
  else console.log('✅ ' + name + '  段數=' + cs.length + ' 最長=' + Math.max(...cs.map(c=>c[0].length)));
}
const zh = '不採用 15W 標準版的原因是：25W 版成本約人民幣 22 元，與 15W 版本價格幾乎相同，因此直接採 25W，可在價格競爭條件下多一個明確賣點。';
check('短句（不分段）', zh, 900);
check('多行報告', Array.from({length:12}, (_,i) => `${i+1}、項目標題\n` + zh).join('\n'), 900);
check('超長單行（無換行）', zh.repeat(20), 900);
check('超長單行（無標點）', '甲'.repeat(3000), 900);
check('空行與連續換行', '一\n\n\n二\n' + zh + '\n\n' + zh, 400);
check('結尾換行', zh + '\n', 900);
check('英文長段', 'The container number changed. '.repeat(120), 900);
check('剛好等於上限', 'x'.repeat(900), 900);
check('上限加一', 'x'.repeat(901), 900);
check('混合 CRLF', ('一行\r\n' + zh + '\r\n').repeat(6), 500);
console.log(fail ? `\n❌ ${fail}/${n} 個案例失敗` : `\n✅ 全部 ${n} 個案例通過：分段不會遺失或改動任何一個字`);
