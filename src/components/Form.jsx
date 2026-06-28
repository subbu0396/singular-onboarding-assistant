import { useState } from 'react';
import DocUpload from '@/components/DocUpload';
import { mergeExtractedFields } from '@/lib/mapExtractedFields';
import {
  SECTIONS,
  INDUSTRIES,
  PRIMARY_MARKETS,
  PLATFORMS,
  CURRENT_MMP_OPTIONS,
  ATTRIBUTION_MODELS,
  INTEGRATION_METHODS,
  DATA_EXPORT_METHODS,
  EVENT_TRACKING_METHODS,
  BACKEND_LANGUAGES,
  AUTH_METHODS,
  URGENCY_OPTIONS,
  TARGET_MMP_PLATFORMS,
  INITIAL_FORM_STATE,
  validateSection,
  resetSectionFields,
  isSectionDirty,
  getDemoFormData,
  DEMO_SECTION_INDEX,
} from '@/lib/formConfig';

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-400">{message}</p>;
}

function CheckboxGroup({ id, label, options, selected, onChange, error }) {
  const toggle = (option) => {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    onChange(next);
  };

  return (
    <div id={id}>
      <label className="form-label">{label}</label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:border-slate-600"
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-accent focus:ring-indigo-accent"
            />
            {option}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </div>
  );
}

function SelectField({ id, label, value, onChange, options, placeholder, error }) {
  return (
    <div id={id}>
      <label className="form-label">{label}</label>
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || 'Select...'}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <FieldError message={error} />
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          value ? 'bg-indigo-accent' : 'bg-slate-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function scrollToFirstError(errorKeys) {
  const firstErrorKey = errorKeys[0];
  if (!firstErrorKey) return;
  document.getElementById(firstErrorKey)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

const GENERATION_STEPS = [
  'Analyzing tech stack...',
  'Generating documents...',
  'Finalizing...',
];

function GenerationProgress({ loadingStep }) {
  const currentIndex = GENERATION_STEPS.indexOf(loadingStep);

  return (
    <div className="mt-4">
      {GENERATION_STEPS.map((step, i) => {
        const isDone = i < currentIndex;
        const isActive = step === loadingStep;

        return (
          <div
            key={step}
            className={`mb-2 flex items-center gap-2 ${isDone || isActive ? 'opacity-100' : 'opacity-30'}`}
          >
            <span className="text-sm">{isDone ? '✓' : isActive ? '⏳' : '○'}</span>
            <span className={`text-sm ${isActive ? 'font-medium text-white' : 'text-slate-400'}`}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Form({ onSubmit, isLoading, loadingStep, error, onClearError }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM_STATE);
  const [errors, setErrors] = useState({});
  const [demoBanner, setDemoBanner] = useState(false);

  const clearError = (errorKey) => {
    setErrors((prev) => {
      if (!prev[errorKey]) return prev;
      const next = { ...prev };
      delete next[errorKey];
      return next;
    });
  };

  const update = (field, value, errorKey = field) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    clearError(errorKey);
  };

  const mergeExtracted = (extracted) => {
    setForm((prev) => mergeExtractedFields(prev, extracted));
  };

  const handleNext = () => {
    const newErrors = validateSection(currentStep, form);
    const errorKeys = Object.keys(newErrors);

    if (errorKeys.length > 0) {
      setErrors(newErrors);
      scrollToFirstError(errorKeys);
      return;
    }

    setErrors({});
    setCurrentStep((prev) => Math.min(prev + 1, SECTIONS.length - 1));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const newErrors = validateSection(currentStep, form);
    const errorKeys = Object.keys(newErrors);

    if (errorKeys.length > 0) {
      setErrors(newErrors);
      scrollToFirstError(errorKeys);
      return;
    }

    setErrors({});
    onSubmit(form);
  };

  const section = SECTIONS[currentStep];

  const handleResetSection = () => {
    setForm((prev) => resetSectionFields(prev, section.key));
    setErrors({});
  };

  const handleStartOver = () => {
    setForm(INITIAL_FORM_STATE);
    setCurrentStep(0);
    setErrors({});
    setDemoBanner(false);
  };

  const handleTryDemo = () => {
    setForm(getDemoFormData());
    setErrors({});
    setDemoBanner(true);
    setCurrentStep(DEMO_SECTION_INDEX);
    onClearError?.();
  };

  const sectionIsDirty = isSectionDirty(form, section.key);

  const renderSection = () => {
    switch (section.key) {
      case 'clientInfo':
        return (
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleTryDemo}
              disabled={isLoading}
              className="btn-secondary w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-40"
            >
              Try Demo →
            </button>
            <div id="clientName">
              <label className="form-label">Client Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Acme Corp"
                value={form.clientName}
                onChange={(e) => update('clientName', e.target.value)}
              />
              <FieldError message={errors.clientName} />
            </div>
            <SelectField
              id="targetMmp"
              label="Target MMP Platform"
              value={form.targetMmp}
              onChange={(v) => update('targetMmp', v)}
              options={TARGET_MMP_PLATFORMS}
              placeholder="Select attribution platform..."
              error={errors.targetMmp}
            />
            <p className="text-xs text-slate-500">
              Documents will be generated for the selected mobile measurement platform.
            </p>
            <SelectField
              id="industry"
              label="Industry"
              value={form.industry}
              onChange={(v) => update('industry', v)}
              options={INDUSTRIES}
              error={errors.industry}
            />
            <SelectField
              id="primaryMarket"
              label="Primary Market"
              value={form.primaryMarket}
              onChange={(v) => update('primaryMarket', v)}
              options={PRIMARY_MARKETS}
              error={errors.primaryMarket}
            />
          </div>
        );

      case 'sdkSetup':
        return (
          <div className="space-y-4">
            <CheckboxGroup
              id="platforms"
              label="Platforms"
              options={PLATFORMS}
              selected={form.platforms}
              onChange={(v) => update('platforms', v)}
              error={errors.platforms}
            />
            <SelectField
              id="currentMMP"
              label="Current / Previous MMP"
              value={form.currentMmp}
              onChange={(v) => update('currentMmp', v, 'currentMMP')}
              options={CURRENT_MMP_OPTIONS}
              placeholder="Select if migrating..."
              error={errors.currentMMP}
            />
            <SelectField
              id="attributionModel"
              label="Attribution Model Preference"
              value={form.attributionModel}
              onChange={(v) => update('attributionModel', v)}
              options={ATTRIBUTION_MODELS}
              error={errors.attributionModel}
            />
          </div>
        );

      case 'integrationType':
        return (
          <div className="space-y-4">
            <CheckboxGroup
              id="integrationMethods"
              label="Integration Methods to Configure"
              options={INTEGRATION_METHODS}
              selected={form.integrationMethods}
              onChange={(v) => update('integrationMethods', v)}
              error={errors.integrationMethods}
            />
            <CheckboxGroup
              id="exportMethods"
              label="Data Export Method"
              options={DATA_EXPORT_METHODS}
              selected={form.dataExportMethods}
              onChange={(v) => update('dataExportMethods', v, 'exportMethods')}
              error={errors.exportMethods}
            />
            <SelectField
              id="eventTracking"
              label="Event Tracking Method"
              value={form.eventTrackingMethod}
              onChange={(v) => update('eventTrackingMethod', v, 'eventTracking')}
              options={EVENT_TRACKING_METHODS}
              error={errors.eventTracking}
            />
          </div>
        );

      case 'techEnvironment':
        return (
          <div className="space-y-4">
            <SelectField
              id="backendLanguage"
              label="Backend Language"
              value={form.backendLanguage}
              onChange={(v) => update('backendLanguage', v)}
              options={BACKEND_LANGUAGES}
              error={errors.backendLanguage}
            />
            <ToggleField
              label="Has existing data warehouse?"
              value={form.hasDataWarehouse}
              onChange={(v) => update('hasDataWarehouse', v)}
            />
            <ToggleField
              label="Uses a CDP?"
              value={form.usesCdp}
              onChange={(v) => update('usesCdp', v)}
            />
            {form.usesCdp && (
              <div id="cdpName">
                <label className="form-label">CDP Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Segment, mParticle"
                  value={form.cdpName}
                  onChange={(e) => update('cdpName', e.target.value)}
                />
                <FieldError message={errors.cdpName} />
              </div>
            )}
            <SelectField
              id="authMethod"
              label="Authentication Method in Use"
              value={form.authMethod}
              onChange={(v) => update('authMethod', v)}
              options={AUTH_METHODS}
              error={errors.authMethod}
            />
          </div>
        );

      case 'timeline':
        return (
          <div className="space-y-4">
            <div id="goLiveDate">
              <label className="form-label">Target Go-Live Date</label>
              <input
                type="date"
                className="form-input form-date-input"
                value={form.targetGoLiveDate}
                onChange={(e) => update('targetGoLiveDate', e.target.value, 'goLiveDate')}
              />
              <FieldError message={errors.goLiveDate} />
            </div>
            <SelectField
              id="urgency"
              label="Onboarding Urgency"
              value={form.onboardingUrgency}
              onChange={(v) => update('onboardingUrgency', v, 'urgency')}
              options={URGENCY_OPTIONS}
              error={errors.urgency}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
      <DocUpload onExtracted={mergeExtracted} />

      <div className="mb-6 flex items-center gap-3">
        <hr className="flex-1 border-slate-700" />
        <span className="text-xs text-slate-500">or fill manually</span>
        <hr className="flex-1 border-slate-700" />
      </div>

      {/* Stepper nav */}
      <nav className="mb-8" aria-label="Form sections">
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s, idx) => {
            const isActive = idx === currentStep;
            const isDone = idx < currentStep;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setCurrentStep(idx)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  isActive
                    ? 'bg-indigo-accent text-white'
                    : isDone
                      ? 'bg-indigo-accent/20 text-indigo-300'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <span className="hidden sm:inline">Section {s.id} — </span>
                {s.title}
              </button>
            );
          })}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-indigo-accent transition-all duration-300"
            style={{ width: `${((currentStep + 1) / SECTIONS.length) * 100}%` }}
          />
        </div>
      </nav>

      {demoBanner && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-400">
          Form prefilled with Airtel Digital demo data
        </div>
      )}

      {/* Section panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            Section {section.id}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">{section.title}</h2>
        </div>

        {renderSection()}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={handleResetSection}
            disabled={!sectionIsDirty || isLoading}
            className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset Section
          </button>
          <button
            type="button"
            onClick={handleStartOver}
            disabled={isLoading}
            className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Over
          </button>
        </div>

        <div className="mt-4 flex flex-col">
          {error && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
              <span>⚠ {error}</span>
              <button
                type="button"
                onClick={onClearError}
                className="cursor-pointer border-none bg-transparent px-1 text-base text-red-400"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
              disabled={currentStep === 0 || isLoading}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>

            {currentStep < SECTIONS.length - 1 ? (
              <button type="button" onClick={handleNext} disabled={isLoading} className="btn-primary disabled:cursor-not-allowed disabled:opacity-60">
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? 'Generating...' : 'Generate Documents'}
              </button>
            )}
          </div>

          {isLoading && currentStep === SECTIONS.length - 1 && (
            <GenerationProgress loadingStep={loadingStep} />
          )}
        </div>
      </div>
    </form>
  );
}
