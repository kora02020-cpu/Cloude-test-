// 同期なし。記録は端末内(localStorage)だけに残り、未送信キューは溜まったままになる。
// あとで同期先を設定してログインすると、溜まった分がまとめて送られる。
export function createNoneAdapter() {
  return {
    enabled: false,
    signedIn: () => false,
    email: () => '',
  };
}
