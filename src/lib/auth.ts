import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getSupabaseAdmin } from "./supabase";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [Google],
  callbacks: {
    authorized({ auth: session }) {
      // Returning false causes the middleware to redirect to the sign-in page
      return !!session?.user;
    },
    async signIn({ user }) {
      if (!user.email) return true;
      // Upsert the user into web_users on first sign-in
      const supabase = getSupabaseAdmin();
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
