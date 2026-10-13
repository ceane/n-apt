import React from 'react';
import { render, screen } from '@testing-library/react';
import TranscriptFixerRoute from '../../src/app-legal/routes/TranscriptFixerRoute';
import { useTranscriptFixer } from '../../src/app-legal/hooks/useTranscriptFixer';

jest.mock('../../src/app-legal/hooks/useTranscriptFixer', () => ({useTranscriptFixer:jest.fn()}));

test('archive preview renders links but never activates untrusted worker markup', () => {
  (useTranscriptFixer as jest.Mock).mockReturnValue({
    archives:[],selectedArchive:'fixture',summary:{selectedCount:1,filteredCount:1},
    status:{},filters:{filterRetweets:false,filterNonReplyLinks:false,keywords:[],dateRanges:[]},
    filterMode:'auto',searchQuery:'',currentPage:1,totalPages:1,
    pageTweets:[{id:'1',dateLabel:'now',mentionDisplay:'<img src=x onerror="alert(1)"><a href="javascript:alert(1)">evil</a>',
      htmlText:'<a href="https://example.com">safe link</a><svg onload="alert(1)"></svg><script>alert(1)</script>'}],
  });
  const {container} = render(<TranscriptFixerRoute />);
  expect(container.querySelector('img,svg,script,[onerror],[onload]')).toBeNull();
  expect(screen.getByText('evil')).not.toHaveAttribute('href');
  expect(screen.getByText('safe link')).toHaveAttribute('href','https://example.com');
});
