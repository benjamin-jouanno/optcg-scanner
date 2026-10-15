import { Component, Input, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { SetDistributionChart } from '../../components/set-distribution-chart/set-distribution-chart';
import { CollectionCardTile } from '../../components/collection-card-tile/collection-card-tile';
import { LucidePlus, LucideInfo, LucideLayers, LucideTrendingUp, LucideStar, LucideArrowRight, LucideLibrary, LucideShieldCheck, LucideArrowUpRight, LucideCircleAlert } from '@lucide/angular';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [SetDistributionChart, CollectionCardTile, LucidePlus, LucideInfo, LucideLayers, LucideTrendingUp, LucideStar, LucideArrowRight, LucideLibrary, LucideShieldCheck, LucideArrowUpRight, LucideCircleAlert],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
  encapsulation: ViewEncapsulation.None,
})
export class HomePage {
  @Input({ required: true }) context!: App;
}
