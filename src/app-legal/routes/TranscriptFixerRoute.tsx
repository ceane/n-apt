// @ts-nocheck
import { useMemo, useState, useRef } from 'react';
import { useTranscriptFixer } from '../hooks/useTranscriptFixer';

export default function TranscriptFixerRoute() {
  const [keywordInput, setKeywordInput] = useState('');
  const [dateRange, setDateRange] = useState({ name: '', start: '', end: '' });
  const [exportName, setExportName] = useState('');
  const transcript = useTranscriptFixer();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const selectedCountLabel = useMemo(() => transcript.summary.selectedCount, [transcript.summary.selectedCount]);

  function submitDateRange() {
    if (!dateRange.name || !dateRange.start || !dateRange.end) {
      return;
    }
    transcript.addDateRange(dateRange);
    setDateRange({ name: '', start: '', end: '' });
  }

  return (
    <div className="route-stack">
      <header className="route-header">
        <div>
          <p className="eyebrow">Route</p>
          <h2 className="route-title">X Archive Formatter</h2>
          <p className="muted">Select, filter, and export posts from an X archive.</p>
        </div>
      </header>

      <section className="section-card section-stack">
        <div>
          <h3 className="section-title">Archive Selection</h3>
          <p className="muted">Choose an extracted archive or a zip file to process.</p>
        </div>
        <div className="archive-list">
          {transcript.archives.map((archive) => (
            <button
              key={`${archive.name}-${archive.type}`}
              type="button"
              className={`button archive-button${transcript.selectedArchive === archive.name || transcript.selectedArchive === archive.name.replace(/\.zip$/i, '') ? ' selected' : ''}`}
              onClick={() => transcript.selectArchive(archive)}
            >
              <strong>{archive.name}</strong>
              <span className="archive-meta muted">
                <span>{archive.type}</span>
                {archive.userInfo?.userName ? <span>@{archive.userInfo.userName}</span> : null}
                {archive.archiveInfo?.generationDate ? <span>{new Date(archive.archiveInfo.generationDate).toLocaleDateString()}</span> : null}
              </span>
            </button>
          ))}
          {transcript.status.loadingArchives ? <div className="tag">Loading archives…</div> : null}
          <div className="button-row" style={{ marginTop: transcript.archives.length === 0 ? 0 : 0 }}>
            <button
              type="button"
              className="button primary"
              disabled={transcript.status.loadingArchives || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Choose File'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              setUploading(true);
              const formData = new FormData();
              formData.append('archive', file);
              try {
                await transcript.uploadArchive(formData);
              } finally {
                setUploading(false);
                event.target.value = '';
              }
            }}
          />
        </div>
      </section>

      <section className="section-card section-stack">
        <div>
          <h3 className="section-title">Filter Settings</h3>
        </div>
        <div className="controls-grid">
          <label className="tag">
            <input
              type="checkbox"
              checked={transcript.filters.filterRetweets}
              onChange={(event) => transcript.updateFilter('filterRetweets', event.target.checked)}
            />
            Filter out retweets
          </label>
          <label className="tag">
            <input
              type="checkbox"
              checked={transcript.filters.filterNonReplyLinks}
              onChange={(event) => transcript.updateFilter('filterNonReplyLinks', event.target.checked)}
            />
            Filter out non-reply posts with links
          </label>
        </div>
        <div className="controls-grid">
          <div className="field">
            <label htmlFor="keywordInput">Keyword filter</label>
            <div className="button-row">
              <input id="keywordInput" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} />
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  transcript.addKeyword(keywordInput);
                  setKeywordInput('');
                }}
              >
                Add
              </button>
            </div>
            <div className="tag-list">
              {transcript.filters.keywords.map((keyword) => (
                <span key={keyword} className="tag">
                  {keyword}
                  <button type="button" onClick={() => transcript.removeKeyword(keyword)}>×</button>
                </span>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="dateRangeName">Date range</label>
            <input id="dateRangeName" placeholder="Range name" value={dateRange.name} onChange={(event) => setDateRange((previous) => ({ ...previous, name: event.target.value }))} />
            <div className="button-row">
              <input type="date" value={dateRange.start} onChange={(event) => setDateRange((previous) => ({ ...previous, start: event.target.value }))} />
              <input type="date" value={dateRange.end} onChange={(event) => setDateRange((previous) => ({ ...previous, end: event.target.value }))} />
              <button type="button" className="button secondary" onClick={submitDateRange}>Add Range</button>
            </div>
            <div className="tag-list">
              {transcript.filters.dateRanges.map((range, index) => (
                <span key={`${range.name}-${range.start}-${range.end}`} className="tag">
                  {range.name}: {range.start} - {range.end}
                  <button type="button" onClick={() => transcript.removeDateRange(index)}>×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="button-row">
          <label className="tag">
            <input type="radio" name="filterMode" checked={transcript.filterMode === 'auto'} onChange={() => transcript.setFilterMode('auto')} />
            Auto filter
          </label>
          <label className="tag">
            <input type="radio" name="filterMode" checked={transcript.filterMode === 'handpick'} onChange={() => transcript.setFilterMode('handpick')} />
            Handpick mode
          </label>
        </div>
      </section>

      <section className="section-card section-stack">
        <div className="route-header">
          <div>
            <h3 className="section-title">Preview & Selection</h3>
            <p className="muted">{selectedCountLabel} selected out of {transcript.summary.filteredCount} filtered tweets.</p>
          </div>
          <div className="button-row">
            <button type="button" className="button secondary" onClick={transcript.selectAllVisible}>Select visible</button>
            <button type="button" className="button secondary" onClick={transcript.deselectAll}>Deselect all</button>
            <button type="button" className="button secondary" onClick={transcript.invertSelection}>Invert selection</button>
          </div>
        </div>
        <input
          className="search-input"
          type="text"
          placeholder="Search tweets"
          value={transcript.searchQuery}
          onChange={(event) => transcript.setSearchQuery(event.target.value)}
        />
        {transcript.status.loadingTweets ? <div className="tag">Loading tweets…</div> : null}
        <div className="tweet-list">
          {transcript.pageTweets.map((tweet) => (
            <article key={tweet.id} className="tweet-card">
              <div className="route-header">
                <label className="tag">
                  <input
                    type="checkbox"
                    checked={tweet.selected || transcript.filterMode === 'auto'}
                    disabled={transcript.filterMode === 'auto'}
                    onChange={() => transcript.toggleTweetSelection(tweet.id)}
                  />
                  Include
                </label>
                <div className="tweet-meta muted">
                  <span>{tweet.dateLabel}</span>
                </div>
              </div>
              {tweet.mentionDisplay ? <div className="muted" dangerouslySetInnerHTML={{ __html: tweet.mentionDisplay }} /> : null}
              <div className="tweet-text" dangerouslySetInnerHTML={{ __html: tweet.htmlText }} />
              <div className="tweet-flags muted">
                {tweet.isRetweet ? <span className="flag-pill">RT</span> : null}
                {tweet.isReply ? <span className="flag-pill">Reply</span> : null}
                <span className="stat-pill">❤️ {tweet.favoriteCount}</span>
                <span className="stat-pill">🔁 {tweet.retweetCount}</span>
              </div>
            </article>
          ))}
          {!transcript.status.loadingTweets && transcript.pageTweets.length === 0 ? <div className="tag">No tweets match your current filters.</div> : null}
        </div>
        <div className="pagination-row">
          <button type="button" className="button secondary" disabled={transcript.currentPage <= 1} onClick={() => transcript.setCurrentPage(transcript.currentPage - 1)}>Previous</button>
          <span className="muted">Page {transcript.currentPage} of {transcript.totalPages}</span>
          <button type="button" className="button secondary" disabled={transcript.currentPage >= transcript.totalPages} onClick={() => transcript.setCurrentPage(transcript.currentPage + 1)}>Next</button>
        </div>
      </section>

      <section className="section-card section-stack">
        <div>
          <h3 className="section-title">Export</h3>
          <p className="muted">Export a filtered archive zip from the selected tweets.</p>
        </div>
        <div className="field">
          <label htmlFor="exportName">Export name</label>
          <input id="exportName" value={exportName} onChange={(event) => setExportName(event.target.value)} placeholder="filtered-archive" />
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button primary"
            disabled={transcript.status.exporting || !transcript.selectedArchive || transcript.summary.selectedCount === 0}
            onClick={() => transcript.exportArchive(exportName)}
          >
            {transcript.status.exporting ? 'Exporting…' : 'Export Archive'}
          </button>
        </div>
        {transcript.status.exporting ? (
          <div className="progress-bar">
            <div className="progress-fill indeterminate" />
          </div>
        ) : null}
        {transcript.status.exportResult ? (
          <div className="tag-list">
            <span className="tag">{transcript.status.exportResult.tweetCount} tweets exported</span>
            <a className="button primary" href={`/api/download/${transcript.status.exportResult.zipPath}`}>Download zip</a>
          </div>
        ) : null}
      </section>
    </div>
  );
}
