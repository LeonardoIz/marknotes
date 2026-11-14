import type { Metadata } from "next";
import { Suspense } from "react";
import { Page } from "@/components/Page";
import { SettingsTabs } from "@/components/SettingsTabs";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <Page className="mx-auto w-full max-w-[760px]">
      <div className="flex flex-col gap-2">
        <span className="kicker">Preferences</span>
        <h1 className="font-serif text-[38px] leading-none tracking-[-0.015em]">Settings</h1>
      </div>
      <div className="mt-8">
        <Suspense fallback={<div className="h-10" />}>
          <SettingsTabs />
        </Suspense>
      </div>
      <div className="mt-8">{children}</div>
    </Page>
  );
}
