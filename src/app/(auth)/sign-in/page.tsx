"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import Checkbox from "@/components/ui/Checkbox";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function SignInPage() {
  const router = useRouter();
  const session = authClient.useSession();

  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {}
  );
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);

  const signInSchema = z.object({
    email: z.string().email({ message: "Enter a valid email address" }),
    password: z
      .string()
      .min(6, { message: "Password must be at least 6 characters" }),
  });

  // Redirect if already logged in
  useEffect(() => {
    if (session.data?.session) {
      router.replace("/dashboard");
    }
  }, [session.data?.session, router]);

  // Load saved email if user had chosen remember me previously
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedEmail = localStorage.getItem("cleano_remember_email");
    if (savedEmail) {
      setFormData((prev) => ({ ...prev, email: savedEmail }));
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Clear any previous global errors
    setGlobalError(null);

    // Validate form data with Zod
    const validation = signInSchema.safeParse(formData);
    if (!validation.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      validation.error.issues.forEach((issue) => {
        if (issue.path[0] === "email") fieldErrors.email = issue.message;
        if (issue.path[0] === "password") fieldErrors.password = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    // Persist or clear email based on remember-me
    if (typeof window !== "undefined") {
      if (rememberMe) {
        localStorage.setItem("cleano_remember_email", formData.email);
      } else {
        localStorage.removeItem("cleano_remember_email");
      }
    }

    setLoading(true);

    try {
      const res = await authClient.signIn.email({
        email: formData.email,
        password: formData.password,
        callbackURL: "/dashboard",
      });

      if (res.error) {
        // Set user-friendly error messages based on specific auth error codes
        let errorMessage = "Please check your credentials and try again.";

        const errorMsg = res.error.message?.toLowerCase() || "";
        const statusCode = res.error.status || res.error.code;

        // Check HTTP status codes first (more reliable)
        if (statusCode === 401) {
          errorMessage =
            "The email or password is incorrect. Please check and try again.";
        } else if (statusCode === 403) {
          errorMessage =
            "Access denied. Please contact support if this continues.";
        } else if (statusCode === 429) {
          errorMessage =
            "Too many attempts. Please wait a few minutes before trying again.";
        } else if (typeof statusCode === "number" && statusCode >= 500) {
          errorMessage = "Server error. Please try again in a few moments.";
        }
        // Then check error message content for more specific cases
        else if (
          errorMsg.includes("invalid login credentials") ||
          errorMsg.includes("invalid credentials")
        ) {
          errorMessage =
            "The email or password is incorrect. Please check and try again.";
        } else if (
          errorMsg.includes("email not confirmed") ||
          errorMsg.includes("email_not_confirmed")
        ) {
          errorMessage = "Please verify your email address before signing in.";
        } else if (
          errorMsg.includes("user not found") ||
          errorMsg.includes("user_not_found")
        ) {
          errorMessage =
            "No account found. Please sign up or check your email.";
        } else if (
          errorMsg.includes("too many requests") ||
          errorMsg.includes("rate limit") ||
          errorMsg.includes("too_many_requests")
        ) {
          errorMessage =
            "Too many attempts. Please wait a few minutes before trying again.";
        } else if (
          errorMsg.includes("network") ||
          errorMsg.includes("fetch") ||
          errorMsg.includes("connection")
        ) {
          errorMessage =
            "Connection issue. Please check your internet and try again.";
        } else if (
          errorMsg.includes("account disabled") ||
          errorMsg.includes("account_disabled")
        ) {
          errorMessage =
            "This account has been disabled. Please contact support.";
        }

        setGlobalError(errorMessage);
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setGlobalError("Unexpected error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="h-screen bg-white relative overflow-hidden flex">
      {/* Hero Section - Hidden on mobile, shown on lg+ */}
      <div
        className="hidden lg:flex flex-1 relative overflow-hidden m-4 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, #005F6A 0%, #007580 50%, #004952 100%)",
        }}>
        {/* Background blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 left-[15%] w-[40rem] h-[40rem] rounded-full bg-[#81c6c7]/30 blur-[180px]" />
          <div className="absolute top-[55%] -right-32 w-[48rem] h-[48rem] rounded-full bg-[#005F6A]/40 blur-[200px]" />
          <div className="absolute bottom-[-15%] left-[-5%] w-[50rem] h-[50rem] rounded-full bg-[#003d45]/60 blur-[210px]" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 h-full w-full flex flex-col items-start justify-center px-12 xl:px-16">
          <div className="flex flex-col items-start justify-center space-y-6 max-w-xl">
            {/* Logo */}
            {/* <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-[500] text-white tracking-tight">
                Cleano
              </span>
            </div> */}

            <h1 className="text-5xl xl:text-6xl text-white leading-[1.1] font-[350]">
              Welcome Back
            </h1>
            <p className="max-w-md font-[350] text-white/80 text-lg !leading-relaxed">
              Sign in to your Cleano account and continue managing your cleaning
              operations with ease.
            </p>

            {/* Decorative elements */}
            <div className="mt-8 flex items-center gap-4">
              <div className="flex -space-x-3">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-10 h-10 rounded-full bg-white/15 backdrop-blur-sm border-2 border-white/25"
                  />
                ))}
              </div>
              <span className="text-white/70 text-sm">
                Trusted by cleaning teams everywhere
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Form Section */}
      <div className="w-full lg:w-1/2 lg:shrink-0 h-screen flex items-center justify-center bg-[#f8fafa] lg:bg-white p-4">
        <div className="w-full max-w-md mx-auto px-4 md:px-8 py-8 md:py-12">
          {/* Mobile Logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#005F6A]/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#005F6A]" />
            </div>
            <span className="text-xl font-[500] text-[#005F6A] tracking-tight">
              Cleano
            </span>
          </div>

          <div className="w-full flex flex-col items-start gap-1 mb-8">
            <h1 className="h2-title">Sign In</h1>
            <p className="h2-subheader">
              Enter your credentials to access your account.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-4 md:space-y-6 w-full">
            <div className="space-y-4">
              {/* Email */}
              <div>
                <label className="input-label">Email Address *</label>
                <Input
                  variant="form"
                  type="email"
                  size="lg"
                  border={false}
                  className="px-4 py-3"
                  required
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="Enter your email"
                  autoComplete="email"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="input-label">Password *</label>
                <div className="relative">
                  <Input
                    variant="form"
                    size="lg"
                    border={false}
                    className="px-4 py-3 pr-12"
                    type={showPassword ? "text" : "password"}
                    required
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    error={!!errors.password}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center">
                    {showPassword ? (
                      <EyeOff className="w-4 h-4 text-[#005F6A]/50 hover:text-[#005F6A] transition-colors" />
                    ) : (
                      <Eye className="w-4 h-4 text-[#005F6A]/50 hover:text-[#005F6A] transition-colors" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                )}
              </div>
            </div>

            {/* Global Error */}
            {globalError && (
              <div className="p-4 bg-red-50/50 rounded-xl border border-red-100">
                <p className="text-sm font-[350] tracking-tight text-red-600/80">
                  {globalError}
                </p>
              </div>
            )}

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Checkbox
                  color="primary"
                  checked={rememberMe}
                  onChange={() => setRememberMe(!rememberMe)}
                />
                <label className="ml-2 text-sm text-[#005F6A]">
                  Remember me
                </label>
              </div>
              <Link
                href="/forgot-password"
                className="text-sm text-[#005F6A]/80 hover:text-[#005F6A] transition-colors">
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <div className="w-full flex justify-center md:justify-end pt-4">
              <Button
                variant="action"
                size="lg"
                className="w-full md:w-auto px-8 py-3 text-base"
                disabled={loading}
                loading={loading}>
                {loading ? "Signing In..." : "Sign In"}
              </Button>
            </div>

            {/* Sign Up Link */}
            <p className="pt-4 text-center text-sm text-[#005F6A]/80">
              Don&apos;t have an account?{" "}
              <Link
                href="/sign-up"
                className="font-medium text-[#005F6A] hover:text-[#005F6A]/80 transition-colors underline underline-offset-2">
                Sign up
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
