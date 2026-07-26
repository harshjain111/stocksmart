import { PageHeader } from "@/components/shared/page-header";

/* Placeholder home — the real to-do-list Home screen is built in prompt 4.13. */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Home"
        description="Your to-do list lands here in a later phase — for now this just proves the nav shell and role filtering work."
      />
    </div>
  );
}
