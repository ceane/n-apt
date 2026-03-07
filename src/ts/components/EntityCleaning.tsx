/**
 * Entity Data Cleaning Component
 * Provides UI for cleaning and validating FCC entities data
 */

import React, { useState, useCallback } from 'react';
import { EntityValidator, ValidationResult, CleaningStats } from '../utils/entityValidation';

interface EntityCleaningProps {
  onDataCleaned?: (cleanedData: Record<string, any>, stats: CleaningStats) => void;
}

export const EntityCleaning: React.FC<EntityCleaningProps> = ({ onDataCleaned }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<CleaningStats | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleResults, setSampleResults] = useState<ValidationResult[]>([]);

  const processEntityFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setProgress(0);
    setStats(null);
    setSampleResults([]);

    try {
      const text = await file.text();
      const entitiesData = JSON.parse(text);

      const validator = new EntityValidator();
      const totalRecords = Object.keys(entitiesData).length;
      let processedCount = 0;
      const sampleValidations: ValidationResult[] = [];

      // Process in chunks to show progress
      const chunkSize = 1000;
      const entries = Object.entries(entitiesData);

      for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const chunkObject = Object.fromEntries(chunk);

        const _result = validator.processBatch(chunkObject);
        processedCount += chunk.length;

        // Collect sample results for display
        if (i === 0) {
          // Get first few validation results as samples
          for (let j = 0; j < Math.min(5, chunk.length); j++) {
            const [_id, record] = chunk[j];
            const validation = validator.validateAndClean(record);
            sampleValidations.push(validation);
          }
        }

        setProgress(Math.round((processedCount / totalRecords) * 100));

        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const finalStats = validator.getStats();
      const finalResult = validator.processBatch(entitiesData);

      setStats(finalStats);
      setSampleResults(sampleValidations);
      onDataCleaned?.(finalResult.cleanedRecords, finalStats);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process file');
    } finally {
      setIsProcessing(false);
    }
  }, [onDataCleaned]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/json') {
      setSelectedFile(file);
      setError(null);
    } else {
      setError('Please select a valid JSON file');
    }
  }, []);

  const handleProcess = useCallback(() => {
    if (selectedFile) {
      processEntityFile(selectedFile);
    }
  }, [selectedFile, processEntityFile]);

  const downloadCleanedData = useCallback(async () => {
    if (!stats) return;

    try {
      const response = await fetch('/api/entities/cleaned');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'entities_cleaned.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_err) {
      setError('Failed to download cleaned data');
    }
  }, [stats]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return 'text-red-600';
      case 'warning': return 'text-yellow-600';
      case 'info': return 'text-blue-600';
      default: return 'text-gray-600';
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Entity Data Cleaning</h2>

      {/* File Selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Entities JSON File
        </label>
        <input
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {/* Process Button */}
      <div className="mb-6">
        <button
          onClick={handleProcess}
          disabled={!selectedFile || isProcessing}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Clean Data'}
        </button>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Processing...</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Statistics */}
      {stats && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Cleaning Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{formatNumber(stats.totalProcessed)}</div>
              <div className="text-sm text-gray-600">Total Processed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{formatNumber(stats.validRecords)}</div>
              <div className="text-sm text-gray-600">Valid Records</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{formatNumber(stats.cleanedRecords)}</div>
              <div className="text-sm text-gray-600">Cleaned Records</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{formatNumber(stats.discardedRecords)}</div>
              <div className="text-sm text-gray-600">Discarded Records</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{formatNumber(stats.duplicatesRemoved)}</div>
              <div className="text-sm text-gray-600">Duplicates Removed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">{formatNumber(stats.issuesFixed.length)}</div>
              <div className="text-sm text-gray-600">Issues Fixed</div>
            </div>
          </div>
        </div>
      )}

      {/* Sample Validation Results */}
      {sampleResults.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Sample Validation Results</h3>
          <div className="space-y-3">
            {sampleResults.map((result, index) => (
              <div key={index} className="p-3 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${result.isValid ? 'text-green-600' : 'text-red-600'}`}>
                    {result.isValid ? '✓ Valid' : '✗ Invalid'}
                  </span>
                  <span className={`text-sm ${getSeverityColor(result.severity)}`}>
                    {result.severity}
                  </span>
                </div>
                {result.issues.length > 0 && (
                  <ul className="text-sm text-gray-600 space-y-1">
                    {result.issues.map((issue, i) => (
                      <li key={i} className="flex items-start">
                        <span className="mr-2">•</span>
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues Fixed Summary */}
      {stats && stats.issuesFixed.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Common Issues Fixed</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {stats.issuesFixed.slice(0, 10).map((issue, index) => (
              <div key={index} className="text-sm text-gray-600 flex items-start">
                <span className="mr-2 text-green-600">✓</span>
                <span>{issue}</span>
              </div>
            ))}
            {stats.issuesFixed.length > 10 && (
              <div className="text-sm text-gray-500 italic">
                ... and {stats.issuesFixed.length - 10} more issues
              </div>
            )}
          </div>
        </div>
      )}

      {/* Download Button */}
      {stats && (
        <div className="mb-6">
          <button
            onClick={downloadCleanedData}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Download Cleaned Data
          </button>
        </div>
      )}

      {/* Data Quality Tips */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="text-lg font-semibold mb-2 text-blue-800">Data Quality Improvements</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Removes duplicate records based on entity name and address</li>
          <li>• Validates and corrects city-state mismatches (e.g., Boston in MA, not Kingston)</li>
          <li>• Standardizes zip code formats (5-digit or 9-digit with hyphen)</li>
          <li>• Converts full state names to 2-letter codes</li>
          <li>• Identifies and flags neighborhood names incorrectly listed as cities</li>
          <li>• Removes records with invalid or missing critical data</li>
        </ul>
      </div>
    </div>
  );
};

export default EntityCleaning;
