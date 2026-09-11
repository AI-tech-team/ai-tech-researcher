/** ホーム描画と新ナビ(記事/分析)の存在を確認。 */
(async () => {
  try {
    const res = await fetch('http://localhost:3000/');
    const html = await res.text();
    console.log(`status=${res.status} htmlLen=${html.length}`);
    console.log(`hasError=${/Application error|Unhandled Runtime|TypeError/i.test(html)}`);
    console.log(`「記事」=${html.includes('記事')} 「分析」=${html.includes('分析')} 「全体概要」=${html.includes('全体概要')}`);
    console.log(`旧「後で読む」タブ残存=${html.includes('後読み')}`);
  } catch (e: any) { console.error('ERROR', e.message); }
  process.exit(0);
})();
