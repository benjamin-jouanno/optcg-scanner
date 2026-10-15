import { Component, ElementRef, Input, ViewChild, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { LucideCamera, LucideScanLine, LucideSearch, LucideRotateCcw, LucideRotateCw, LucideCircleAlert, LucideInfo, LucideLayers, LucidePencil, LucideTrash2 } from '@lucide/angular';

@Component({
  selector: 'app-scanner-page',
  standalone: true,
  imports: [LucideCamera, LucideScanLine, LucideSearch, LucideRotateCcw, LucideRotateCw, LucideCircleAlert, LucideInfo, LucideLayers, LucidePencil, LucideTrash2],
  templateUrl: './scanner-page.html',
  styleUrl: './scanner-page.css',
  encapsulation: ViewEncapsulation.None,
})
export class ScannerPage {
  @ViewChild('cameraVideo') cameraVideo?: ElementRef<HTMLVideoElement>;
  @Input({ required: true }) context!: App;
}
