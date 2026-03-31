import React from 'react';
import { render, screen } from '@testing-library/react';
import { SimplePretextDemo } from '@n-apt/components/pretext/SimplePretextDemo';

describe('Pretext Integration', () => {
  it('should render SimplePretextDemo without crashing', () => {
    render(<SimplePretextDemo />);
    expect(screen.getByText('Simple Pretext Demo')).toBeInTheDocument();
  });

  it('should display frequency information', () => {
    render(<SimplePretextDemo />);
    expect(screen.getByText(/Frequency updates automatically/)).toBeInTheDocument();
  });

  it('should show pretext hook status', () => {
    render(<SimplePretextDemo />);
    expect(screen.getByText(/Pretext hook status:/)).toBeInTheDocument();
  });
});
