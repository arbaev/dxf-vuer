// Лексер DXF файлов — разбирает текст на пары (код, значение)

export interface IGroup {
  code: number;
  value: number | string | boolean;
}

/**
 * Сканер массива строк DXF файла.
 * На основе спецификации AutoCAD 2012 DXF Reference.
 */
export default class DxfScanner {
  private _pointer = 0;
  private _eof = false;
  private _data: string[];
  public lastReadGroup!: IGroup;

  constructor(data: string[]) {
    this._data = data;
  }

  /** Читает следующую пару (код, значение) */
  public next(): IGroup {
    if (!this.hasNext()) {
      if (!this._eof)
        throw new Error(
          "Unexpected end of input: EOF group not read before end of file. Ended on code " +
            this._data[this._pointer],
        );
      else throw new Error("Cannot call 'next' after EOF group has been read");
    }

    const group = {
      code: parseInt(this._data[this._pointer]),
    } as IGroup;

    this._pointer++;

    group.value = parseGroupValue(group.code, this._data[this._pointer].trim());

    this._pointer++;

    if (group.code === 0 && group.value === "EOF") this._eof = true;

    this.lastReadGroup = group;

    return group;
  }

  /** Подсматривает следующую пару без продвижения указателя */
  public peek(): IGroup {
    if (!this.hasNext()) {
      if (!this._eof)
        throw new Error(
          "Unexpected end of input: EOF group not read before end of file. Ended on code " +
            this._data[this._pointer],
        );
      else throw new Error("Cannot call 'peek' after EOF group has been read");
    }

    const group = {
      code: parseInt(this._data[this._pointer]),
    } as IGroup;

    group.value = parseGroupValue(group.code, this._data[this._pointer + 1].trim());

    return group;
  }

  /** Перемотка назад на указанное количество групп */
  public rewind(numberOfGroups = 1): void {
    this._pointer = this._pointer - numberOfGroups * 2;
  }

  /** Есть ли ещё данные для чтения */
  public hasNext(): boolean {
    if (this._eof) return false;
    if (this._pointer > this._data.length - 2) return false;
    return true;
  }

  /** Достигнут ли конец файла (группа EOF) */
  public isEOF(): boolean {
    return this._eof;
  }
}

/**
 * Типизация значения по диапазону DXF-кода.
 * См. AutoCAD DXF Reference, стр. 3-10.
 */
function parseGroupValue(code: number, value: string): number | string | boolean {
  if (code <= 9) return value;
  if (code >= 10 && code <= 59) return parseFloat(value);
  if (code >= 60 && code <= 99) return parseInt(value);
  if (code >= 100 && code <= 109) return value;
  if (code >= 110 && code <= 149) return parseFloat(value);
  if (code >= 160 && code <= 179) return parseInt(value);
  if (code >= 210 && code <= 239) return parseFloat(value);
  if (code >= 270 && code <= 289) return parseInt(value);
  if (code >= 290 && code <= 299) return value === "1";
  if (code >= 300 && code <= 369) return value;
  if (code >= 370 && code <= 389) return parseInt(value);
  if (code >= 390 && code <= 399) return value;
  if (code >= 400 && code <= 409) return parseInt(value);
  if (code >= 410 && code <= 419) return value;
  if (code >= 420 && code <= 429) return parseInt(value);
  if (code >= 430 && code <= 439) return value;
  if (code >= 440 && code <= 459) return parseInt(value);
  if (code >= 460 && code <= 469) return parseFloat(value);
  if (code >= 470 && code <= 481) return value;
  if (code === 999) return value;
  if (code >= 1000 && code <= 1009) return value;
  if (code >= 1010 && code <= 1059) return parseFloat(value);
  if (code >= 1060 && code <= 1071) return parseInt(value);

  return value;
}
