import { useState } from 'react';
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
  validateForm,
} from '@/lib/formConfig';

function CheckboxGroup({ label, options, selected, onChange }) {
  const toggle = (option) => {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option];
    onChange(next);
  };

  return (
    <div>
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
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || 'Select...'}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
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

export default function Form({ onSubmit, isLoading }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM_STATE);
  const [errors, setErrors] = useState([]);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors([]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationErrors = validateForm(form);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    onSubmit(form);
  };

  const section = SECTIONS[currentStep];

  const renderSection = () => {
    switch (section.key) {
      case 'clientInfo':
        return (
          <div className="space-y-4">
            <div>
              <label className="form-label">Client Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Acme Corp"
                value={form.clientName}
                onChange={(e) => update('clientName', e.target.value)}
              />
            </div>
            <SelectField
              label="Target MMP Platform"
              value={form.targetMmp}
              onChange={(v) => update('targetMmp', v)}
              options={TARGET_MMP_PLATFORMS}
              placeholder="Select attribution platform..."
            />
            <p className="text-xs text-slate-500">
              Documents will be generated for the selected mobile measurement platform.
            </p>
            <SelectField
              label="Industry"
              value={form.industry}
              onChange={(v) => update('industry', v)}
              options={INDUSTRIES}
            />
            <SelectField
              label="Primary Market"
              value={form.primaryMarket}
              onChange={(v) => update('primaryMarket', v)}
              options={PRIMARY_MARKETS}
            />
          </div>
        );

      case 'sdkSetup':
        return (
          <div className="space-y-4">
            <CheckboxGroup
              label="Platforms"
              options={PLATFORMS}
              selected={form.platforms}
              onChange={(v) => update('platforms', v)}
            />
            <SelectField
              label="Current / Previous MMP"
              value={form.currentMmp}
              onChange={(v) => update('currentMmp', v)}
              options={CURRENT_MMP_OPTIONS}
              placeholder="Select if migrating..."
            />
            <SelectField
              label="Attribution Model Preference"
              value={form.attributionModel}
              onChange={(v) => update('attributionModel', v)}
              options={ATTRIBUTION_MODELS}
            />
          </div>
        );

      case 'integrationType':
        return (
          <div className="space-y-4">
            <CheckboxGroup
              label="Integration Methods to Configure"
              options={INTEGRATION_METHODS}
              selected={form.integrationMethods}
              onChange={(v) => update('integrationMethods', v)}
            />
            <CheckboxGroup
              label="Data Export Method"
              options={DATA_EXPORT_METHODS}
              selected={form.dataExportMethods}
              onChange={(v) => update('dataExportMethods', v)}
            />
            <SelectField
              label="Event Tracking Method"
              value={form.eventTrackingMethod}
              onChange={(v) => update('eventTrackingMethod', v)}
              options={EVENT_TRACKING_METHODS}
            />
          </div>
        );

      case 'techEnvironment':
        return (
          <div className="space-y-4">
            <SelectField
              label="Backend Language"
              value={form.backendLanguage}
              onChange={(v) => update('backendLanguage', v)}
              options={BACKEND_LANGUAGES}
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
              <div>
                <label className="form-label">CDP Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Segment, mParticle"
                  value={form.cdpName}
                  onChange={(e) => update('cdpName', e.target.value)}
                />
              </div>
            )}
            <SelectField
              label="Authentication Method in Use"
              value={form.authMethod}
              onChange={(v) => update('authMethod', v)}
              options={AUTH_METHODS}
            />
          </div>
        );

      case 'timeline':
        return (
          <div className="space-y-4">
            <div>
              <label className="form-label">Target Go-Live Date</label>
              <input
                type="date"
                className="form-input"
                value={form.targetGoLiveDate}
                onChange={(e) => update('targetGoLiveDate', e.target.value)}
              />
            </div>
            <SelectField
              label="Onboarding Urgency"
              value={form.onboardingUrgency}
              onChange={(v) => update('onboardingUrgency', v)}
              options={URGENCY_OPTIONS}
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
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

      {/* Section panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            Section {section.id}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">{section.title}</h2>
        </div>

        {renderSection()}

        {errors.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm font-medium text-red-400">Please fix the following:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-red-300">
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>

          {currentStep < SECTIONS.length - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => Math.min(SECTIONS.length - 1, s + 1))}
              className="btn-primary"
            >
              Next
            </button>
          ) : (
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? 'Generating...' : 'Generate Documents'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
