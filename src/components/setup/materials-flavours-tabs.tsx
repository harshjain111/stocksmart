"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialsView } from "@/components/setup/materials-view";
import { FlavoursView } from "@/components/setup/flavours-view";

type Material = {
  id: string;
  code: string | null;
  name: string;
  default_supplier_id: string | null;
  is_active: boolean;
};
type Supplier = { id: string; name: string };
type Rate = {
  id: string;
  raw_material_id: string;
  supplier_id: string;
  rate: number;
  source: "manual" | "grn";
  created_at: string;
};
type Flavour = {
  id: string;
  code: string | null;
  name: string;
  current_version_id: string | null;
  default_supplier_id: string | null;
  is_active: boolean;
};

type TabValue = "materials" | "flavours";

export function MaterialsFlavoursTabs({
  materials,
  suppliers,
  rates,
  flavours,
}: {
  materials: Material[];
  suppliers: Supplier[];
  rates: Rate[];
  flavours: Flavour[];
}) {
  const [tab, setTab] = React.useState<TabValue>("materials");

  return (
    <div className="grid gap-6">
      {/*
        Deliberately not using TabsContent/Tabs.Panel here: Base UI's panel
        unmount relies on detecting a CSS transition's completion, and with
        no transition defined on the panel it never fires — both panels stay
        rendered and visible at once. Driving the active view with plain
        state sidesteps that instead of depending on it.
      */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="flavours">Flavours</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "materials" ? (
        <MaterialsView
          materials={materials}
          suppliers={suppliers}
          rates={rates}
        />
      ) : (
        <FlavoursView flavours={flavours} suppliers={suppliers} />
      )}
    </div>
  );
}
