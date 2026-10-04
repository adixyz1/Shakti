import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Delete } from 'lucide-react';
import { verifyDisguiseSequenceCandidate } from '../store/triggerSettingsStore';

export interface DisguiseCalculatorProps {
  sequenceHash: string | null;
  onUnlock: () => void;
}

export function evaluateCalculatorMath(
  left: number,
  operator: string,
  right: number
): string {
  let result = 0;
  switch (operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '×':
    case '*':
      result = left * right;
      break;
    case '÷':
    case '/':
      if (right === 0) return 'Error';
      result = left / right;
      break;
    default:
      return String(right);
  }
  const rounded = Math.round(result * 1e10) / 1e10;
  return String(rounded);
}

export const DisguiseCalculator: React.FC<DisguiseCalculatorProps> = ({
  sequenceHash,
  onUnlock,
}) => {
  const { t } = useTranslation();

  const [display, setDisplay] = useState<string>('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState<boolean>(false);
  const [expressionPreview, setExpressionPreview] = useState<string>('');
  const [, setKeyBuffer] = useState<string>('');

  const recordSecretKey = (keyChar: string) => {
    setKeyBuffer((prev) => {
      const next = (prev + keyChar).slice(-32);
      if (sequenceHash) {
        void verifyDisguiseSequenceCandidate(next, sequenceHash).then(
          (matched) => {
            if (matched) {
              onUnlock();
            }
          }
        );
      }
      return next;
    });
  };

  const handleDigit = (digit: string) => {
    recordSecretKey(digit);
    if (display === 'Error') {
      setDisplay(digit);
      setWaitingForOperand(false);
      return;
    }

    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const handleDecimal = () => {
    recordSecretKey('.');
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleClear = () => {
    setKeyBuffer('');
    setDisplay('0');
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setExpressionPreview('');
  };

  const handleBackspace = () => {
    if (waitingForOperand || display === 'Error') return;
    if (display.length <= 1) {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handlePercent = () => {
    recordSecretKey('%');
    const current = parseFloat(display);
    if (Number.isNaN(current)) return;
    setDisplay(String(current / 100));
  };

  const handleOperator = (nextOp: string) => {
    const keyToken =
      nextOp === '×' ? '*' : nextOp === '÷' ? '/' : nextOp;
    recordSecretKey(keyToken);

    const inputValue = parseFloat(display);
    if (Number.isNaN(inputValue)) return;

    if (previousValue === null) {
      setPreviousValue(inputValue);
    } else if (operator && !waitingForOperand) {
      const computed = evaluateCalculatorMath(
        previousValue,
        operator,
        inputValue
      );
      setDisplay(computed);
      setPreviousValue(computed === 'Error' ? null : parseFloat(computed));
    }

    setWaitingForOperand(true);
    setOperator(nextOp);
    setExpressionPreview(`${inputValue} ${nextOp}`);
  };

  const handleEquals = () => {
    recordSecretKey('=');
    if (operator === null || previousValue === null) {
      return;
    }

    const inputValue = parseFloat(display);
    if (Number.isNaN(inputValue)) return;

    const computed = evaluateCalculatorMath(
      previousValue,
      operator,
      inputValue
    );
    setExpressionPreview(`${previousValue} ${operator} ${inputValue} =`);
    setDisplay(computed);
    setPreviousValue(null);
    setOperator(null);
    setWaitingForOperand(true);
  };

  return (
    <div
      data-testid="disguise-calculator"
      className="min-h-screen bg-slate-950 text-slate-50 flex flex-col items-center justify-center p-4"
    >
      <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>{t('disguise.calculatorTitle')}</span>
          <span className="font-mono">STD</span>
        </div>

        {/* Display Screen */}
        <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 text-right space-y-1 min-h-[96px] flex flex-col justify-end">
          <div
            data-testid="calc-expression"
            className="text-xs font-mono text-slate-400 min-h-[18px] truncate"
          >
            {expressionPreview}
          </div>
          <div
            aria-live="polite"
            data-testid="calc-display"
            className="text-4xl font-bold font-mono tracking-tight text-white truncate tabular-nums"
          >
            {display}
          </div>
        </div>

        {/* Keypad Grid (all buttons >= 56px) */}
        <div className="grid grid-cols-4 gap-2.5">
          <button
            type="button"
            data-testid="calc-key-C"
            aria-label={t('disguise.clearLabel')}
            onClick={handleClear}
            className="min-h-[56px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-rose-400 font-bold text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            C
          </button>
          <button
            type="button"
            data-testid="calc-key-backspace"
            aria-label={t('disguise.backspaceLabel')}
            onClick={handleBackspace}
            className="min-h-[56px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-lg inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <Delete className="w-5 h-5" />
          </button>
          <button
            type="button"
            data-testid="calc-key-%"
            aria-label="Percent"
            onClick={handlePercent}
            className="min-h-[56px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            %
          </button>
          <button
            type="button"
            data-testid="calc-key-÷"
            aria-label="Divide"
            onClick={() => handleOperator('÷')}
            className="min-h-[56px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            ÷
          </button>

          {['7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`calc-key-${d}`}
              aria-label={`Calculator digit ${d}`}
              onClick={() => handleDigit(d)}
              className="min-h-[56px] rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-semibold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            data-testid="calc-key-×"
            aria-label="Multiply"
            onClick={() => handleOperator('×')}
            className="min-h-[56px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            ×
          </button>

          {['4', '5', '6'].map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`calc-key-${d}`}
              aria-label={`Calculator digit ${d}`}
              onClick={() => handleDigit(d)}
              className="min-h-[56px] rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-semibold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            data-testid="calc-key--"
            aria-label="Subtract"
            onClick={() => handleOperator('-')}
            className="min-h-[56px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            -
          </button>

          {['1', '2', '3'].map((d) => (
            <button
              key={d}
              type="button"
              data-testid={`calc-key-${d}`}
              aria-label={`Calculator digit ${d}`}
              onClick={() => handleDigit(d)}
              className="min-h-[56px] rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-semibold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            data-testid="calc-key-+"
            aria-label="Add"
            onClick={() => handleOperator('+')}
            className="min-h-[56px] rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            +
          </button>

          <button
            type="button"
            data-testid="calc-key-0"
            aria-label="Calculator digit 0"
            onClick={() => handleDigit('0')}
            className="col-span-2 min-h-[56px] rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-semibold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            0
          </button>
          <button
            type="button"
            data-testid="calc-key-."
            aria-label="Decimal point"
            onClick={handleDecimal}
            className="min-h-[56px] rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            .
          </button>
          <button
            type="button"
            data-testid="calc-key-="
            aria-label="Equals"
            onClick={handleEquals}
            className="min-h-[56px] rounded-2xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            =
          </button>
        </div>
      </div>
    </div>
  );
};
