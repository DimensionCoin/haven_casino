// components/user/QuickCreateUserButton.tsx
"use client";

import React, { useState, type FormEvent } from "react";
import { useUser } from "@/providers/UserProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

type QuickCreateUserButtonProps = {
  /**
   * Optional render prop so you can control how the trigger looks.
   * e.g. renderTrigger={(open, hasAccount) => <DropdownMenuItem onClick={open}>Profile</DropdownMenuItem>}
   */
  renderTrigger?: (open: () => void, hasAccount: boolean) => React.ReactNode;
};

const QuickCreateUserButton: React.FC<QuickCreateUserButtonProps> = ({
  renderTrigger,
}) => {
  const { isLoggedIn, address, user, userLoading, refreshUser } = useUser();
  const router = useRouter();

  const hasAccount = !!user;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = () => {
    if (!isLoggedIn || !address) return;

    // 🔁 If user already has an account, go straight to /settings
    if (hasAccount) {
      router.push("/settings");
      return;
    }

    // Otherwise, open "create" modal
    setName("");
    setError(null);
    setOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address) return;

    // We only use the modal for create now
    if (!name.trim()) return;

    try {
      setSubmitting(true);
      setError(null);

      const res = await fetch("/api/user/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: address,
          name: name.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Failed to create user.");
        return;
      }

      // Pull fresh user from backend
      await refreshUser();

      // success – close modal
      setOpen(false);
    } catch (err) {
      console.error("QuickCreateUser error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const trigger = renderTrigger ? (
    renderTrigger(openModal, hasAccount)
  ) : (
    <button
      type="button"
      onClick={openModal}
      disabled={!isLoggedIn || !address || userLoading}
      className="text-xs text-amber-200/90 hover:text-amber-100 underline-offset-2 hover:underline disabled:opacity-40"
    >
      {hasAccount ? "Open settings" : "Make account"}
    </button>
  );

  return (
    <>
      {trigger}

      {/* Only used when user does NOT have an account yet */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create your Celler profile</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              We only need a name and your wallet to set up your player profile.
              Later we’ll add rewards, referrals and notifications.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Wallet address
              </label>
              <div className="text-xs break-all rounded-md bg-muted/40 px-2 py-1 border border-border/60">
                {address}
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="display-name"
                className="text-xs font-medium text-muted-foreground"
              >
                Name
              </label>
              <Input
                id="display-name"
                placeholder="What should we call you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>

            {error && <p className="text-xs text-destructive mt-1">{error}</p>}

            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? "Saving..." : "Make account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default QuickCreateUserButton;
