import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getSupabaseAdmin } from "./supabase";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [Google],
  callbacks: {
    authorized({ auth: session }) {
      // Returning false causes the middleware to redirect to the sign-in page
      return !!session?.user;
    },
    async signIn({ user }) {
      if (!user.email) return false;

      const supabase = getSupabaseAdmin();

      // Check allowlist — only emails in admin_allowed_emails may sign in.
      // ilike with the exact string makes the match case-insensitive.
      const { data: allowed, error } = await supabase
        .from("admin_allowed_emails")
        .select("id")
        .ilike("email", user.email)
        .maybeSingle();

      // Fail closed: deny on lookup errors as well as missing rows
      if (error || !allowed) {
        return "/login?error=AccessDenied";
      }

      // No user record is persisted: the allowlist is the source of truth
      // (the old `web_users` table was never created in the shared project).
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
});
