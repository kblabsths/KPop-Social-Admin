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

      // Check allowlist — only emails in admin_allowed_emails may sign in
      const { data: allowed } = await supabase
        .from("admin_allowed_emails")
        .select("id")
        .eq("email", user.email)
        .maybeSingle();

      if (!allowed) {
        return "/login?error=AccessDenied";
      }

      // Upsert the web_users record for allowlisted users only
      const { data: existing } = await supabase
        .from("web_users")
        .select("id")
        .eq("email", user.email)
        .maybeSingle();

      if (!existing) {
        await supabase.from("web_users").insert({
          id: user.id,
          name: user.name ?? null,
          email: user.email,
          image: user.image ?? null,
        });
      }

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
