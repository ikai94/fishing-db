'use client';

import { useCallback, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { CatchReportForm, type CatchReportFormValidationState } from './catch-report-form';
import type { CatchReportDraft, DraftStatus } from '@/lib/catch-reports-api';

const FIELD_LABELS: Record<keyof CatchReportDraft['fields'], string> = {
  fishingBase: 'Рыболовная база',
  location: 'Локация',
  fish: 'Рыба',
  bait: 'Наживка или приманка',
  weightGrams: 'Вес',
  fishingMethod: 'Способ ловли',
  holeDepthCm: 'Глубина ямки',
  spotPositionRaw: 'Позиция',
  fishingNote: 'Условие ловли',
  spinningSize: 'Размер спиннинга',
  spinningSpeed: 'Скорость проводки',
  userNoteRaw: 'Комментарий',
};

export function CatchReportDraftPreview({
  draft,
  canSave,
}: {
  draft: CatchReportDraft;
  canSave: boolean;
}) {
  const [validationState, setValidationState] = useState<CatchReportFormValidationState>(() =>
    initialValidationState(draft),
  );
  const updateValidationState = useCallback((next: CatchReportFormValidationState) => {
    setValidationState((current) => (sameValidationState(current, next) ? current : next));
  }, []);
  const liveBlockingFields = new Set(validationState.blockingFields);
  const fieldEntries = Object.entries(draft.fields) as Array<
    [keyof CatchReportDraft['fields'], CatchReportDraft['fields'][keyof CatchReportDraft['fields']]]
  >;
  const relevantFields = fieldEntries.filter(
    ([, field]) => field.required || field.sourceText !== null,
  );
  const visibleIssues = draft.issues.filter(
    (issue) =>
      issue.severity === 'WARNING' ||
      !isDraftFieldName(issue.field) ||
      liveBlockingFields.has(issue.field),
  );
  return (
    <div className={styles.previewStack}>
      <section
        className={`${styles.message} ${validationState.canConfirm ? styles.successMessage : styles.warningMessage}`}
        aria-live="polite"
      >
        <h2 className={styles.forbiddenTitle}>
          {validationState.canConfirm
            ? 'Черновик готов. Проверьте данные и предупреждения.'
            : 'Исправьте обязательные поля перед публикацией.'}
        </h2>
        <p>
          Поля с ошибками можно исправить ниже. Публикация всегда пройдёт полную проверку на
          сервере.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="parse-details-title">
        <h2 className={styles.panelTitle} id="parse-details-title">
          Результат распознавания
        </h2>
        <dl className={styles.parseFieldList}>
          {relevantFields.map(([name, field]) => (
            <div key={name}>
              <dt>{FIELD_LABELS[name]}</dt>
              <dd>
                <StatusBadge
                  field={name}
                  status={field.status}
                  blocking={liveBlockingFields.has(name)}
                />
                {field.sourceText !== null ? (
                  <span className={styles.sourceExcerpt}>{field.sourceText}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>

        {visibleIssues.length > 0 ? (
          <div className={styles.issueList}>
            <h3 className={styles.subheading}>Важно проверить</h3>
            <ul>
              {visibleIssues.map((issue, index) => (
                <li
                  className={
                    issue.severity === 'BLOCKING' ? styles.blockingIssue : styles.warningIssue
                  }
                  key={`${issue.code}:${index}`}
                >
                  <strong>
                    {issue.severity === 'BLOCKING' ? 'Нужно исправить' : 'Предупреждение'}:
                  </strong>{' '}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {draft.unresolvedFragments.length > 0 ? (
          <div className={styles.issueList}>
            <h3 className={styles.subheading}>Нераспознанные фрагменты</h3>
            <p className={styles.fieldHint}>
              Они остаются в приватном исходнике и не становятся комментарием автоматически.
            </p>
            <ul>
              {draft.unresolvedFragments.map((fragment) => (
                <li key={`${fragment.start}:${fragment.end}`}>
                  <code>{fragment.text}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <CatchReportForm
        initialDraft={draft}
        canSave={canSave}
        onValidationStateChange={updateValidationState}
      />
    </div>
  );
}

function StatusBadge({
  field,
  status,
  blocking,
}: {
  field: keyof CatchReportDraft['fields'];
  status: DraftStatus;
  blocking: boolean;
}) {
  const label = blocking
    ? 'Нужно исправить'
    : status === 'RESOLVED'
      ? 'Распознано'
      : field === 'holeDepthCm' ||
          field === 'spotPositionRaw' ||
          field === 'fishingNote' ||
          field === 'spinningSize' ||
          field === 'spinningSpeed' ||
          field === 'userNoteRaw'
        ? 'Не распознано'
        : 'Исправлено';
  return (
    <span
      className={`${styles.draftStatus} ${blocking ? styles.unresolvedStatus : styles.resolvedStatus}`}
    >
      {label}
    </span>
  );
}

function initialValidationState(draft: CatchReportDraft): CatchReportFormValidationState {
  const blockingFields = draft.issues
    .filter((issue) => issue.severity === 'BLOCKING' && isDraftFieldName(issue.field))
    .map((issue) => issue.field as keyof CatchReportDraft['fields']);
  const fishingMethod =
    draft.fields.fishingMethod.status === 'RESOLVED' ? draft.fields.fishingMethod.value : null;
  return {
    canConfirm: draft.canConfirm,
    blockingFields: [...new Set(blockingFields)].sort(),
    fishingMethod,
  };
}

function isDraftFieldName(field: string | undefined): field is keyof CatchReportDraft['fields'] {
  return field !== undefined && Object.prototype.hasOwnProperty.call(FIELD_LABELS, field);
}

function sameValidationState(
  current: CatchReportFormValidationState,
  next: CatchReportFormValidationState,
): boolean {
  return (
    current.canConfirm === next.canConfirm &&
    current.fishingMethod === next.fishingMethod &&
    current.blockingFields.length === next.blockingFields.length &&
    current.blockingFields.every((field, index) => field === next.blockingFields[index])
  );
}
