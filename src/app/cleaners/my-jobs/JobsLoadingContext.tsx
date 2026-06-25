"use client";

import { createContext, useContext, useState } from "react";

interface JobsLoadingContextType {
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const JobsLoadingContext = createContext<JobsLoadingContextType | undefined>(
  undefined
);

export function JobsLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <JobsLoadingContext.Provider value={{ loading, setLoading }}>
      {children}
    </JobsLoadingContext.Provider>
  );
}

export function useJobsLoading() {
  const context = useContext(JobsLoadingContext);
  if (!context) {
    throw new Error("useJobsLoading must be used within JobsLoadingProvider");
  }
  return context;
}

