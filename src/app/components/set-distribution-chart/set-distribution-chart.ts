import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

export interface SetDistributionItem {
  code: string;
  count: number;
}

interface ChartSlice extends SetDistributionItem {
  color: string;
  percentage: number;
}

@Component({
  selector: 'app-set-distribution-chart',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './set-distribution-chart.html',
  styleUrl: './set-distribution-chart.css',
})
export class SetDistributionChart {
  @Input({ required: true }) sets: SetDistributionItem[] = [];
  @Input() compact = false;

  private readonly colors = ['#65c6e8', '#a88be0', '#e8bd62', '#78c99b', '#ed8da7', '#7d9df0', '#e28f63', '#70c9c2'];

  get slices(): ChartSlice[] {
    const identifiedSets = this.sets.filter((set) => /^[A-Z]+-\d+$/i.test(set.code) && set.count > 0);
    const total = identifiedSets.reduce((sum, set) => sum + set.count, 0);
    return identifiedSets.map((set, index) => ({
      ...set,
      color: this.colors[index % this.colors.length],
      percentage: total ? (set.count / total) * 100 : 0,
    }));
  }

  get total(): number {
    return this.slices.reduce((sum, slice) => sum + slice.count, 0);
  }

  get chartBackground(): string {
    if (!this.slices.length) return '#24343d';
    let position = 0;
    const stops = this.slices.map((slice) => {
      const start = position;
      position += slice.percentage;
      return `${slice.color} ${start}% ${position}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }
}

