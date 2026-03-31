import React, { useState, useEffect } from "react";
import { MainContent } from "@n-apt/components/Layout";

type TaskType = 'sentiment-analysis' | 'text-generation' | 'feature-extraction' | 'question-answering';

export const TransformersRoute: React.FC = () => {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>("I love transformers!");
  const [error, setError] = useState<string>("");
  const [modelLoading, setModelLoading] = useState<boolean>(true);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [pipeline, setPipeline] = useState<any>(null);
  const [progress, setProgress] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<string>("Initializing...");
  const [selectedTask, setSelectedTask] = useState<TaskType>('sentiment-analysis');

  // Load model on component mount
  useEffect(() => {
    loadModel();
  }, [selectedTask]);

  const loadModel = async () => {
    setModelLoading(true);
    setModelReady(false);
    setError("");
    setProgress(0);
    setProgressStatus("Initializing...");

    try {
      console.log('Loading transformers.js model...');

      // Use the installed package, not CDN fallback
      const transformers = await import('@huggingface/transformers');
      console.log('Transformers imported:', Object.keys(transformers));

      // Create and cache the pipeline for selected task
      console.log(`Creating ${selectedTask} pipeline...`);
      setProgressStatus('Loading model files...');

      let modelConfig: any = {
        dtype: 'q8',
        device: 'wasm'
      };

      let modelName = '';
      switch (selectedTask) {
        case 'sentiment-analysis':
          modelName = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
          break;
        case 'text-generation':
          modelName = 'Xenova/distilgpt2';
          break;
        case 'feature-extraction':
          modelName = 'Xenova/all-MiniLM-L6-v2';
          break;
        case 'question-answering':
          modelName = 'Xenova/distilbert-base-cased-distilled-squad';
          break;
        default:
          modelName = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
      }

      if (selectedTask === 'text-generation') {
        delete modelConfig.dtype;
      }

      const pipe = await transformers.pipeline(selectedTask, modelName, modelConfig);

      console.log('Pipeline created:', typeof pipe, pipe);
      setPipeline(() => pipe);
      setModelReady(true);
      setProgress(100);
      setProgressStatus('Model loaded successfully!');
      console.log('Model loaded successfully!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(`Failed to load model: ${errorMessage}`);
      console.error('Model loading error:', error);
      setModelReady(false);
    } finally {
      setModelLoading(false);
    }
  };

  const runAnalysis = async () => {
    console.log('runAnalysis called, pipeline:', typeof pipeline, pipeline);

    if (!pipeline || !inputText.trim()) {
      console.log('Early return - no pipeline or empty text');
      return;
    }

    setLoading(true);
    setResult("");
    setError("");

    try {
      console.log(`Running ${selectedTask} on:`, inputText);

      let output: any;

      switch (selectedTask) {
        case 'sentiment-analysis':
          output = await pipeline(inputText);
          break;
        case 'text-generation':
          output = await pipeline(inputText, {
            max_length: 50,
            num_return_sequences: 1,
            temperature: 0.7
          });
          break;
        case 'feature-extraction':
          output = await pipeline(inputText);
          output = {
            embedding_shape: output.data?.shape || [0],
            embedding_sample: Array.from(output.data?.slice(0, 5) || []).map((n: number) => n.toFixed(6))
          };
          break;
        case 'question-answering':
          // For QA, we need context and question
          const context = inputText;
          const question = "What is the main topic?";
          output = await pipeline({ question, context });
          break;
        default:
          output = await pipeline(inputText);
      }

      console.log('Analysis result:', output);
      setResult(JSON.stringify(output, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      console.error('Analysis error:', error);
    } finally {
      setLoading(false);
    }
  };

  const reloadModel = () => {
    setModelReady(false);
    setPipeline(null);
    loadModel();
  };

  const getTaskDescription = () => {
    switch (selectedTask) {
      case 'sentiment-analysis':
        return "Classify text as positive or negative sentiment";
      case 'text-generation':
        return "Generate text based on your input prompt";
      case 'feature-extraction':
        return "Extract text embeddings for semantic search";
      case 'question-answering':
        return "Answer questions based on the provided context";
      default:
        return "Analyze text with transformers";
    }
  };

  const getInputPlaceholder = () => {
    switch (selectedTask) {
      case 'sentiment-analysis':
        return "Enter text to analyze sentiment...";
      case 'text-generation':
        return "Enter a text prompt to continue...";
      case 'feature-extraction':
        return "Enter text to extract embeddings from...";
      case 'question-answering':
        return "Enter context text for question answering...";
      default:
        return "Enter text...";
    }
  };

  return (
    <MainContent>
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Transformers.js Demo</h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Experiment with multiple AI tasks using Hugging Face Transformers.js directly in your browser!
            </p>
          </div>

          {/* Task Selection */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Select AI Task</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { id: 'sentiment-analysis', label: 'Sentiment Analysis', icon: '😊' },
                { id: 'text-generation', label: 'Text Generation', icon: '✍️' },
                { id: 'feature-extraction', label: 'Embeddings', icon: '🔍' },
                { id: 'question-answering', label: 'Q&A', icon: '❓' }
              ].map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task.id as TaskType)}
                  className={`p-4 rounded-lg border-2 transition-all ${selectedTask === task.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                >
                  <div className="text-2xl mb-2">{task.icon}</div>
                  <div className="font-medium text-sm">{task.label}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">{getTaskDescription()}</p>
            </div>
          </div>

          {/* Model Loading Status */}
          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">Model Status</h2>

            {modelLoading && (
              <div className="space-y-4">
                <div className="flex items-center justify-center space-x-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-gray-700 font-medium">{progressStatus}</span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>

                <div className="text-center">
                  <span className="text-sm text-gray-500">{Math.round(progress)}% Complete</span>
                </div>
              </div>
            )}

            {modelReady && (
              <div className="flex items-center justify-center space-x-3">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm">✓</span>
                </div>
                <span className="text-green-700 font-medium text-lg">Model ready for analysis!</span>
              </div>
            )}

            {error && !modelLoading && (
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm">✗</span>
                  </div>
                  <span className="text-red-700 font-medium">Model failed to load</span>
                </div>
                <button
                  onClick={reloadModel}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Analysis Interface */}
          <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
              {selectedTask === 'sentiment-analysis' && 'Sentiment Analysis'}
              {selectedTask === 'text-generation' && 'Text Generation'}
              {selectedTask === 'feature-extraction' && 'Feature Extraction'}
              {selectedTask === 'question-answering' && 'Question Answering'}
            </h2>

            <div className="space-y-6">
              <div>
                <label htmlFor="input-text" className="block text-sm font-medium text-gray-700 mb-2">
                  Input Text:
                </label>
                <textarea
                  id="input-text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={!modelReady}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed resize-none"
                  rows={4}
                  placeholder={getInputPlaceholder()}
                />
                {selectedTask === 'question-answering' && (
                  <p className="mt-2 text-sm text-gray-500">
                    The system will ask "What is the main topic?" about your text.
                  </p>
                )}
              </div>

              <div className="flex justify-center">
                <button
                  onClick={runAnalysis}
                  disabled={!modelReady || loading || !inputText.trim()}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium text-lg"
                >
                  {loading ? 'Processing...' : `Run ${selectedTask === 'sentiment-analysis' ? 'Analysis' : selectedTask === 'text-generation' ? 'Generation' : selectedTask === 'feature-extraction' ? 'Extraction' : 'Q&A'}`}
                </button>
              </div>

              {error && modelReady && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="text-lg font-medium text-red-900 mb-2">Error:</h3>
                  <pre className="text-red-800 text-sm whitespace-pre-wrap">{error}</pre>
                </div>
              )}

              {result && (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Result:</h3>
                  <pre className="bg-white p-4 rounded-md border border-gray-200 overflow-x-auto text-sm">
                    {result}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Info Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <h3 className="text-lg font-medium text-blue-900 mb-3">About Transformers.js</h3>
              <p className="text-blue-800 text-sm leading-relaxed">
                Transformers.js brings state-of-the-art machine learning to your browser.
                Models are downloaded on-demand and cached locally for faster subsequent use.
                This demo showcases multiple NLP tasks including sentiment analysis, text generation,
                feature extraction, and question answering.
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-3">Quick Test</h3>
              <p className="text-gray-800 text-sm mb-3">
                You can also test transformers.js directly at:
              </p>
              <a
                href="/transformers-test.html"
                target="_blank"
                className="text-blue-600 hover:text-blue-800 underline font-medium"
              >
                /transformers-test.html
              </a>
            </div>
          </div>
        </div>
      </div>
    </MainContent>
  );
};
