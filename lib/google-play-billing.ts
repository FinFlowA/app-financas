import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

export const GOOGLE_PLAY_PRODUCTS = {
  smart: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_PRODUCT_ID || "finflow_pro",
  premium: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_PRODUCT_ID || "finflow_plus",
} as const;

export const GOOGLE_PLAY_BASE_PLANS = {
  monthly: process.env.EXPO_PUBLIC_GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID || "monthly",
  annual: process.env.EXPO_PUBLIC_GOOGLE_PLAY_ANNUAL_BASE_PLAN_ID || "annual",
} as const;

export async function obfuscatedGooglePlayAccountId(userId: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId);
}

export async function verifyGooglePlayPurchase(purchaseToken: string, productId: string) {
  const { data, error } = await supabase.functions.invoke("google-play-verify-purchase", {
    body: { purchaseToken, productId },
  });
  if (error) throw error;
  return data as {
    verified: boolean;
    status: string;
    plan: "smart" | "premium";
    billingCycle: "monthly" | "annual";
  };
}
