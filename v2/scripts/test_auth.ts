/** Auth.jsのエンドポイントが正しく配線されているか確認（OAuthラウンドトリップはブラウザ必須なので除く）。 */
(async () => {
  try {
    const prov = await fetch('http://localhost:3000/api/auth/providers');
    const provJson = await prov.text();
    console.log(`[providers] status=${prov.status}`);
    console.log('  ', provJson.slice(0, 300));

    const sess = await fetch('http://localhost:3000/api/auth/session');
    console.log(`[session] status=${sess.status} body=${(await sess.text()).slice(0, 120)}`);

    const home = await fetch('http://localhost:3000/');
    const html = await home.text();
    console.log(`[home] status=${home.status} hasLogin=${html.includes('Googleでログイン')} hasError=${/Application error|Unhandled Runtime/i.test(html)}`);
  } catch (e: any) {
    console.error('FETCH ERROR:', e.message);
  }
  process.exit(0);
})();
