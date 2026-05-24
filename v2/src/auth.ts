import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

// v6: マルチユーザー（Googleログイン）。JWTセッション＋usersテーブルにemailでupsert。
export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true, // Vercel等でホスト推定を許可
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, user.email)).limit(1);
      if (existing.length === 0) {
        await db.insert(users).values({ email: user.email, name: user.name ?? null, image: user.image ?? null });
      }
      return true;
    },
    async jwt({ token }) {
      // 初回（uid未設定）に users.id を解決して載せる
      if (token.email && (token as { uid?: number }).uid == null) {
        const u = await db.select({ id: users.id }).from(users).where(eq(users.email, token.email)).limit(1);
        if (u[0]) (token as { uid?: number }).uid = u[0].id;
      }
      return token;
    },
    async session({ session, token }) {
      const uid = (token as { uid?: number }).uid;
      if (session.user && uid != null) (session.user as unknown as { id?: number }).id = uid;
      return session;
    },
  },
});
