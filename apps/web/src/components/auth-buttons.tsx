import { Button } from "@soundcheck/ui/components/button";
import { signIn, signOut } from "@/auth";

/** Starts Google sign-in, which also connects the channel. */
export function ConnectButton({
  label = "Connect YouTube",
  variant = "primary",
}: {
  label?: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/app" });
      }}
    >
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <Button type="submit" variant="ghost">
        Sign out
      </Button>
    </form>
  );
}
