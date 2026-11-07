import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const ownerEmail = "projectwealthpro@gmail.com";

export const authOptions: NextAuthOptions = {
  providers: [GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  })],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ account, profile }) {
      return Boolean(process.env.NEXTAUTH_SECRET && account?.provider === "google" &&
        profile && "email_verified" in profile && profile.email_verified === true && profile.email);
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.isAdmin = account.provider === "google" && profile?.email?.toLowerCase() === ownerEmail &&
          "email_verified" in profile && profile.email_verified === true;
      }
      return token;
    },
    async session({ session, token }) {
      session.isAdmin = token.isAdmin === true;
      return session;
    },
  },
};
