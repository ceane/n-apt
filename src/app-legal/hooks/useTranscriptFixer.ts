// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { transcriptApi } from '../lib/api';

const initialFilters = {
  filterRetweets: false,
  filterNonReplyLinks: false,
  keywords: [],
  dateRanges: [],
};

export function useTranscriptFixer() {
  const workerRef = useRef(null);
  const [archives, setArchives] = useState([]);
  const [selectedArchive, setSelectedArchive] = useState('');
  const [allTweets, setAllTweets] = useState([]);
  const [derived, setDerived] = useState({
    filteredIds: [],
    pageTweets: [],
    totalFiltered: 0,
    totalSearchResults: 0,
    totalPages: 1,
    currentPage: 1,
    selectedCount: 0,
  });
  const [filters, setFilters] = useState(initialFilters);
  const [filterMode, setFilterMode] = useState('auto');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [tweetsPerPage] = useState(50);
  const [selectedTweetIds, setSelectedTweetIds] = useState([]);
  const [status, setStatus] = useState({ loadingArchives: false, loadingTweets: false, exporting: false, error: '', exportResult: null });

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/transcriptWorker', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (event) => {
      const next = event.data;
      setDerived(next);
      setCurrentPage(next.currentPage);
    };
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    let active = true;
    setStatus((previous) => ({ ...previous, loadingArchives: true, error: '' }));
    transcriptApi.listArchives()
      .then((result) => {
        if (!active) {
          return;
        }
        setArchives(result);
      })
      .catch((error) => {
        if (active) {
          setStatus((previous) => ({ ...previous, error: error.message }));
        }
      })
      .finally(() => {
        if (active) {
          setStatus((previous) => ({ ...previous, loadingArchives: false }));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    workerRef.current?.postMessage({
      tweets: allTweets,
      filters,
      searchQuery,
      currentPage,
      tweetsPerPage,
      selectedIds: selectedTweetIds,
    });
  }, [allTweets, currentPage, filters, searchQuery, selectedTweetIds, tweetsPerPage]);

  useEffect(() => {
    if (filterMode === 'auto') {
      setSelectedTweetIds(derived.filteredIds);
    }
  }, [derived.filteredIds, filterMode]);

  const summary = useMemo(() => ({
    selectedCount: filterMode === 'auto' ? derived.filteredIds.length : derived.selectedCount,
    filteredCount: derived.totalFiltered,
    resultCount: derived.totalSearchResults,
  }), [derived, filterMode]);

  async function refreshArchives() {
    const result = await transcriptApi.listArchives();
    setArchives(result);
    return result;
  }

  async function uploadArchive(formData) {
    setStatus((previous) => ({ ...previous, loadingArchives: true, error: '' }));
    try {
      await transcriptApi.uploadArchive(formData);
      await refreshArchives();
    } catch (error) {
      setStatus((previous) => ({ ...previous, error: error.message }));
      throw error;
    } finally {
      setStatus((previous) => ({ ...previous, loadingArchives: false }));
    }
  }

  async function selectArchive(archive) {
    setStatus((previous) => ({ ...previous, loadingTweets: true, error: '', exportResult: null }));
    try {
      let archiveName = archive.name;
      if (archive.type === 'zip') {
        await transcriptApi.extractArchive(archive.name);
        archiveName = archive.name.replace(/\.zip$/i, '');
        await refreshArchives();
      }
      const tweets = await transcriptApi.loadTweets(archiveName);
      setSelectedArchive(archiveName);
      setAllTweets(tweets);
      setCurrentPage(1);
      setSelectedTweetIds(filterMode === 'auto' ? tweets.map((item) => item.tweet.id_str) : []);
    } catch (error) {
      setStatus((previous) => ({ ...previous, error: error.message }));
    } finally {
      setStatus((previous) => ({ ...previous, loadingTweets: false }));
    }
  }

  function updateFilter(name, value) {
    setCurrentPage(1);
    setFilters((previous) => ({ ...previous, [name]: value }));
  }

  function changeFilterMode(mode) {
    setFilterMode(mode);
    if (mode === 'auto') {
      setSelectedTweetIds(derived.filteredIds);
      return;
    }
    setSelectedTweetIds((previous) => previous.filter((id) => derived.filteredIds.includes(id)));
  }

  function addKeyword(keyword) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized || filters.keywords.includes(normalized)) {
      return;
    }
    updateFilter('keywords', [...filters.keywords, normalized]);
  }

  function removeKeyword(keyword) {
    updateFilter('keywords', filters.keywords.filter((entry) => entry !== keyword));
  }

  function addDateRange(range) {
    updateFilter('dateRanges', [...filters.dateRanges, range]);
  }

  function removeDateRange(index) {
    updateFilter('dateRanges', filters.dateRanges.filter((_, rangeIndex) => rangeIndex !== index));
  }

  function toggleTweetSelection(tweetId) {
    if (filterMode === 'auto') {
      return;
    }
    setSelectedTweetIds((previous) => previous.includes(tweetId) ? previous.filter((id) => id !== tweetId) : [...previous, tweetId]);
  }

  function selectAllVisible() {
    if (filterMode === 'auto') {
      setSelectedTweetIds(derived.filteredIds);
      return;
    }
    setSelectedTweetIds((previous) => Array.from(new Set([...previous, ...derived.pageTweets.map((tweet) => tweet.id)])));
  }

  function deselectAll() {
    setSelectedTweetIds([]);
  }

  function invertSelection() {
    if (filterMode === 'auto') {
      const inverted = derived.filteredIds.filter((id) => !selectedTweetIds.includes(id));
      setSelectedTweetIds(inverted);
      return;
    }
    setSelectedTweetIds(derived.filteredIds.filter((id) => !selectedTweetIds.includes(id)));
  }

  async function exportArchive(exportName) {
    if (!selectedArchive) {
      return;
    }
    setStatus((previous) => ({ ...previous, exporting: true, error: '', exportResult: null }));
    try {
      const filteredTweetIds = filterMode === 'auto' ? derived.filteredIds : selectedTweetIds;
      const result = await transcriptApi.exportArchive({
        archiveName: selectedArchive,
        filteredTweetIds,
        exportName: exportName || null,
        filterSettings: filters,
      });
      setStatus((previous) => ({ ...previous, exportResult: result }));
    } catch (error) {
      setStatus((previous) => ({ ...previous, error: error.message }));
    } finally {
      setStatus((previous) => ({ ...previous, exporting: false }));
    }
  }

  return {
    archives,
    selectedArchive,
    filters,
    filterMode,
    searchQuery,
    currentPage,
    tweetsPerPage,
    pageTweets: derived.pageTweets,
    totalPages: derived.totalPages,
    summary,
    status,
    setFilterMode: changeFilterMode,
    setSearchQuery,
    setCurrentPage,
    selectArchive,
    addKeyword,
    removeKeyword,
    addDateRange,
    removeDateRange,
    updateFilter,
    toggleTweetSelection,
    selectAllVisible,
    deselectAll,
    invertSelection,
    exportArchive,
    refreshArchives,
    uploadArchive,
  };
}
