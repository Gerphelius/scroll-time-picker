import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  PipeTransform,
  Renderer2,
  ViewChild,
} from '@angular/core';
import { BehaviorSubject, fromEvent, merge, Subject } from 'rxjs';
import { skip, switchMap, takeUntil, tap } from 'rxjs/operators';

@Component({
  selector: 'app-time-picker',
  templateUrl: './time-picker.component.html',
  styleUrls: ['./time-picker.component.scss'],
})
export class TimePickerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('hoursEl') hoursEl: ElementRef;
  @ViewChild('minutesEl') minutesEl: ElementRef;

  @Input() hoursFormat: 24 | 12 = 24;
  @Input() date: Date;

  @Output() timeChange = new EventEmitter<{ hours: number; minutes: number }>();

  public hours: number[] = [];
  public minutes: number[] = [];
  public sectionElHeight = 0;

  private _choosenTime = {
    hours: 0,
    minutes: 0,
  };
  private _hoursSelector: Selector = null;
  private _minutesSelector: Selector = null;

  constructor(
    private _renderer: Renderer2,
    private _decimalPipe: DecimalPipe
  ) {}

  ngAfterViewInit(): void {
    this._setCurrentTime();

    this._hoursSelector = new Selector(
      'hours',
      this._onTimeSelect.bind(this),
      this.hoursEl.nativeElement,
      this._renderer,
      this.hoursFormat,
      this._decimalPipe,
      this._choosenTime.hours
    );

    this._minutesSelector = new Selector(
      'minutes',
      this._onTimeSelect.bind(this),
      this.minutesEl.nativeElement,
      this._renderer,
      60,
      this._decimalPipe,
      this._choosenTime.minutes
    );
  }

  private _onTimeSelect(data: any) {
    this._choosenTime[data.selectorName] = Number(data.value);

    console.log(this._choosenTime);
  }

  private _setCurrentTime(): void {
    this._choosenTime.minutes = 0; // (this.date || new Date()).getMinutes();
    this._choosenTime.hours = 0; // (this.date || new Date()).getHours();
  }

  ngOnDestroy(): void {
    this._hoursSelector.destroyClass();
    this._minutesSelector.destroyClass();
  }
}

class Selector {
  private _listEl = null;
  private _elHeight = 0;
  private _listHeight = 0;
  private _moveStartPos = 0;
  private _currentListOffset = 0;
  private _fakeElsNum = 4;
  private _drag$ = new BehaviorSubject<boolean>(false);
  private _classDestroy$ = new Subject<boolean>();

  constructor(
    public name: string,
    public changeCallback: (data: {
      value: any;
      el: HTMLElement;
      selectorName: string;
    }) => void,
    private _rootEl: HTMLElement,
    private _renderer: Renderer2,
    private _elsNumber: number,
    private _pipe: PipeTransform,
    private _startElIndex?: number
  ) {
    this._fillSelector();
    this._initEvents();
  }

  public destroyClass(): void {
    this._classDestroy$.next(true);
    this._drag$.next(false);
    this._classDestroy$.unsubscribe();
    this._drag$.unsubscribe();
  }

  private _initEvents(): void {
    const setDragEvent = (type: 'mouse' | 'touch'): void => {
      const eventStartName = type === 'mouse' ? 'mousedown' : 'touchstart';
      const eventEndName = type === 'mouse' ? 'mouseup' : 'touchend';

      fromEvent(this._rootEl, eventStartName)
        .pipe(
          takeUntil(this._classDestroy$),
          tap(() => this._drag$.next(true)),
          switchMap((event: TouchEvent | MouseEvent) => {
            event.preventDefault();
            this._moveStartPos =
              (event as MouseEvent).y ||
              (event as TouchEvent).changedTouches[0].pageY;

            return merge(
              fromEvent(window, `${type}move`).pipe(
                tap(this._onDragMove.bind(this))
              ),
              fromEvent(window, eventEndName).pipe(
                tap(() => {
                  this._drag$.next(false);
                  this._changeElTranslateY(this._offsetToNearesItem());
                  this._selectCurrentEl();
                })
              )
            ).pipe(takeUntil(this._drag$.pipe(skip(1))));
          })
        )
        .subscribe();
    };

    fromEvent(this._rootEl, 'wheel')
      .pipe(takeUntil(this._classDestroy$))
      .subscribe((event: Event) => {
        this._drag$.next(false);
        this._onDragMove(event);
        this._selectCurrentEl();
      });
    setDragEvent('mouse');
    setDragEvent('touch');
  }

  private _fillSelector(): void {
    const tmp = this._fakeElsNum / 2;

    this._listEl = this._renderer.createElement('ul') as HTMLElement;

    for (let i = -tmp; i < this._elsNumber + tmp; ++i) {
      const el = this._renderer.createElement('li') as HTMLElement;
      const value = String(
        i < 0
          ? this._elsNumber + i
          : i > this._elsNumber - 1
          ? i - this._elsNumber
          : i
      );
      const text = this._pipe.transform(value, '2.0');

      this._renderer.setAttribute(el, 'id', value);
      this._renderer.appendChild(el, this._renderer.createText(text));
      this._renderer.appendChild(this._listEl, el);
      this._renderer.appendChild(this._rootEl, this._listEl);
    }

    this._elHeight = this._getElFullHeight(this._listEl.children[0]);
    this._currentListOffset = this._elHeight * -1;
    this._rootEl.style.height = `${this._elHeight * 3}px`;
    this._listHeight = this._elHeight * this._listEl.children.length;
    this._renderer.setStyle(
      this._listEl,
      'transform',
      `translateY(${
        this._startElIndex ? this._getStartElOffset() : this._currentListOffset
      }px)`
    );
    this._renderer.setStyle(this._listEl, 'touch-action', 'none');
  }

  private _onDragMove(event: Event): void {
    event.preventDefault();
    let translationValue = 0;

    this._currentListOffset = Number(
      this._listEl.style.transform.match(/-?\d+/)[0]
    );

    if (event['wheelDeltaY']) {
      const deltaSign = Math.sign(event['wheelDeltaY']);

      translationValue =
        this._offsetToNearesItem() + this._elHeight * deltaSign;
    } else if (event['y']) {
      translationValue = event['y'] - this._moveStartPos;
      this._moveStartPos = event['y'];
    } else if (event['changedTouches']) {
      translationValue = event['changedTouches'][0].pageY - this._moveStartPos;
      this._moveStartPos = event['changedTouches'][0].pageY;
    }

    this._changeElTranslateY(translationValue);
  }

  private _changeElTranslateY(newValue: number): void {
    const boundsStart = this._drag$.getValue()
      ? this._elHeight / 2
      : this._elHeight;
    let newTransform = this._currentListOffset + newValue;

    if (newTransform > -boundsStart) {
      // top bound
      newTransform =
        newValue -
        this._listHeight +
        this._elHeight * this._fakeElsNum -
        boundsStart;
    } else if (newTransform < this._elsNumber * -this._elHeight - boundsStart) {
      // bottom bound
      newTransform = newValue - boundsStart;
    }

    this._currentListOffset = newTransform;

    this._renderer.setStyle(
      this._listEl,
      'transform',
      `translateY(${newTransform}px)`
    );
  }

  private _offsetToNearesItem(): number {
    const scrollOffset = Math.abs(this._currentListOffset % this._elHeight);

    return this._elHeight - scrollOffset > this._elHeight / 2
      ? scrollOffset
      : -(this._elHeight - scrollOffset);
  }

  private _selectCurrentEl(): void {
    const elemIndex = Math.abs(this._currentListOffset / this._elHeight) + 1;

    this.changeCallback({
      value: this._listEl.children[elemIndex].id,
      el: this._listEl.children[elemIndex],
      selectorName: this.name,
    });
  }

  private _getStartElOffset(): number {
    if (this._startElIndex + 1 > this._elsNumber) {
      this._startElIndex = 0;

      console.error(new RangeError('Start position is out of range!'));
    }

    const offset = (this._startElIndex + 1) * -this._elHeight;

    return offset;
  }

  private _getElFullHeight(el: HTMLElement): number {
    const elStyles = getComputedStyle(el);

    return (
      parseFloat(elStyles.height) +
      parseFloat(elStyles.paddingTop) +
      parseFloat(elStyles.paddingBottom) +
      parseFloat(elStyles.marginTop) +
      parseFloat(elStyles.marginBottom)
    );
  }
}
