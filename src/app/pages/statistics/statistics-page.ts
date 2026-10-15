import { Component, Input, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { SetDistributionChart } from '../../components/set-distribution-chart/set-distribution-chart';
import { LucideLayers, LucideDollarSign, LucideBookOpen, LucideHeart, LucideChartNoAxesCombined, LucideInfo, LucideArrowRight } from '@lucide/angular';

@Component({
  selector: 'app-statistics-page',
  standalone: true,
  imports: [SetDistributionChart, LucideLayers, LucideDollarSign, LucideBookOpen, LucideHeart, LucideChartNoAxesCombined, LucideInfo, LucideArrowRight],
  templateUrl: './statistics-page.html',
  styleUrl: './statistics-page.css',
  encapsulation: ViewEncapsulation.None,
})
export class StatisticsPage {
  @Input({ required: true }) context!: App;
}
