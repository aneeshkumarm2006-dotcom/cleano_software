"use client";

import { useEffect } from "react";
import { useJobsLoading } from "./JobsLoadingContext";

export function ClearLoadingOnMount({ dataKey }: { dataKey: string }) {
  const { setLoading } = useJobsLoading();

  useEffect(() => {
    setLoading(false);
  }, [dataKey, setLoading]);

  return null;
}

