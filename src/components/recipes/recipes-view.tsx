"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import { getVersionDetail } from "@/app/(app)/recipes/actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusTag } from "@/components/shared/status-tag";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Flavour = {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  current_version_id: string | null;
};

type VersionSummary = {
  id: string;
  flavour_id: string;
  version_no: number;
  status: "current" | "archived";
  created_at: string;
  batchCount: number;
};

type VersionDetail = {
  note: string;
  createdAt: string;
  createdByName: string;
  lines: { materialName: string; percentage: number }[];
};

export function RecipesView({
  flavours,
  versions,
}: {
  flavours: Flavour[];
  versions: VersionSummary[];
}) {
  const [selectedFlavourId, setSelectedFlavourId] = React.useState<
    string | null
  >(flavours[0]?.id ?? null);
  const [selectedVersionId, setSelectedVersionId] = React.useState<
    string | null
  >(null);
  const [detail, setDetail] = React.useState<VersionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  const flavourVersions = versions
    .filter((v) => v.flavour_id === selectedFlavourId)
    .sort((a, b) => b.version_no - a.version_no);

  async function selectVersion(versionId: string) {
    setSelectedVersionId(versionId);
    setDetail(null);
    setLoadingDetail(true);
    const result = await getVersionDetail(versionId);
    setLoadingDetail(false);
    if (result.success) setDetail(result.data);
  }

  function selectFlavour(flavourId: string) {
    setSelectedFlavourId(flavourId);
    setSelectedVersionId(null);
    setDetail(null);
  }

  if (flavours.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <PageHeader title="Recipes" />
        <EmptyState
          icon={FlaskConical}
          title="No flavours yet"
          description="Add a flavour under Setup > Materials & flavours, then come back here to give it a recipe."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Recipes"
        description="Read-only. Versions are frozen the moment they're saved — there is no edit path."
      />

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <Card className="h-fit">
          <CardContent className="grid gap-1 p-2">
            {flavours.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => selectFlavour(f.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  f.id === selectedFlavourId
                    ? "bg-primary/15 text-primary"
                    : "hover:bg-muted text-foreground",
                )}
              >
                <span className={!f.is_active ? "text-muted-foreground" : ""}>
                  {f.name}
                </span>
                <span className="text-muted-foreground text-xs">{f.code}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {flavourVersions.length === 0 ? (
            <EmptyState
              icon={FlaskConical}
              title="No recipe yet"
              description="This flavour has no recipe versions yet. Build the first one from here once the new-version flow lands."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {flavourVersions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => selectVersion(v.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      v.id === selectedVersionId
                        ? "border-primary bg-primary/10"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="font-qty font-medium">
                      v{v.version_no}
                    </span>
                    <StatusTag status={v.status} />
                    <span className="text-muted-foreground text-xs">
                      {v.batchCount} batch{v.batchCount === 1 ? "" : "es"}
                    </span>
                  </button>
                ))}
              </div>

              {selectedVersionId && (
                <Card>
                  <CardContent className="grid gap-4">
                    {loadingDetail ? (
                      <div className="grid gap-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                      </div>
                    ) : detail ? (
                      <>
                        <div className="grid gap-2">
                          {detail.lines.map((line) => (
                            <div key={line.materialName} className="grid gap-1">
                              <div className="flex items-baseline justify-between text-sm">
                                <span>{line.materialName}</span>
                                <span className="font-qty">
                                  {line.percentage}%
                                </span>
                              </div>
                              <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                  className="bg-primary h-full rounded-full"
                                  style={{ width: `${line.percentage}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="border-t pt-3 text-sm">
                          <p className="text-muted-foreground">
                            &ldquo;{detail.note}&rdquo;
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {detail.createdByName} ·{" "}
                            {new Date(detail.createdAt).toLocaleDateString(
                              "en-IN",
                            )}
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-destructive text-sm">
                        Couldn&apos;t load this version.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
