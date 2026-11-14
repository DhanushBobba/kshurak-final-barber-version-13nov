import { useEffect, useRef, useState } from "react";

import {
  getReviews,
  getReviewStatistics,
  saveReviewReply,
  type Review,
  type ReviewList,
  type ReviewStatistics,
  type ReviewSort,
} from "../services/reviewsApi";

export const REVIEW_PAGE_SIZE = 5;

export interface ReviewQuery {
  search: string;
  serviceName: string;
  rating: number | undefined;
  sort: ReviewSort;
  offset: number;
}

const INITIAL_QUERY: ReviewQuery = {
  search: "",
  serviceName: "",
  rating: undefined,
  sort: "newest",
  offset: 0,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete the request.";
}

export function useReviews() {
  const [query, setQuery] = useState<ReviewQuery>({ ...INITIAL_QUERY });
  const [list, setList] = useState<ReviewList | null>(null);
  const [statistics, setStatistics] = useState<ReviewStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [statisticsLoading, setStatisticsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statisticsError, setStatisticsError] = useState("");
  const [replyError, setReplyError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const mounted = useRef(true);
  const mutation = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setList(null);

    getReviews({ ...query, limit: REVIEW_PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        const lastOffset = result.total > 0
          ? Math.floor((result.total - 1) / REVIEW_PAGE_SIZE) * REVIEW_PAGE_SIZE
          : 0;

        if (query.offset > lastOffset) {
          setQuery((current) => ({ ...current, offset: lastOffset }));
          return;
        }

        setList(result);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(message(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [query, reload]);

  useEffect(() => {
    const controller = new AbortController();
    setStatisticsLoading(true);
    setStatisticsError("");

    getReviewStatistics(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStatistics(result);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setStatisticsError(message(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatisticsLoading(false);
      });

    return () => controller.abort();
  }, [reload]);

  const updateFilters = (changes: Partial<Omit<ReviewQuery, "offset">>) => {
    if (mutation.current) return;
    setQuery((current) => ({ ...current, ...changes, offset: 0 }));
  };

  const changePage = (offset: number) => {
    if (mutation.current || loading) return;
    setQuery((current) => ({ ...current, offset: Math.max(0, offset) }));
  };

  const resetFilters = () => {
    if (!mutation.current) setQuery({ ...INITIAL_QUERY });
  };

  const refresh = () => {
    if (mutation.current) return;
    setSuccess("");
    setReload((value) => value + 1);
  };

  const submitReply = async (review: Review, reply: string): Promise<boolean> => {
    if (mutation.current) return false;
    mutation.current = true;
    setSaving(true);
    setReplyError("");
    setSuccess("");

    try {
      const result = await saveReviewReply(review.id, reply);
      if (!mounted.current) return false;

      setSuccess(result.message || "Reply saved successfully.");
      setReload((value) => value + 1);
      return true;
    } catch (err: unknown) {
      if (mounted.current) setReplyError(message(err));
      return false;
    } finally {
      mutation.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return {
    query,
    list,
    statistics,
    loading,
    statisticsLoading,
    error,
    statisticsError,
    replyError,
    success,
    saving,
    updateFilters,
    changePage,
    resetFilters,
    refresh,
    submitReply,
    clearReplyError: () => setReplyError(""),
  };
}