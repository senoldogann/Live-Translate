#!/usr/bin/env python3
"""
Maestro Quickstart - Interactive Setup Wizard
Helps users choose the right profile and workflow.
"""

import sys
import os

def main():
    print("🚀 Maestro Quickstart Wizard\n")
    print("Bu hızlı kurulum, projeniz için en uygun Maestro yapılandırmasını seçecek.\n")
    
    # Question 1: Project Type
    print("1️⃣ Proje tipi nedir?")
    print("   a) Landing page / Portfolyo / Blog")
    print("   b) SaaS MVP / Web Uygulaması")
    print("   c) Enterprise / Fintech / Critical System")
    
    project_type = input("\nSeçim (a/b/c): ").strip().lower()
    
    # Question 2: Project Size
    print("\n2️⃣ Proje büyüklüğü (tahmini dosya sayısı)?")
    print("   a) Küçük (5-30 dosya)")
    print("   b) Orta (30-100 dosya)")
    print("   c) Büyük (100+ dosya)")
    
    project_size = input("\nSeçim (a/b/c): ").strip().lower()
    
    # Question 3: Team or Solo
    print("\n3️⃣ Ekip mi yoksa solo çalışıyor musun?")
    print("   a) Solo (sadece ben)")
    print("   b) Küçük ekip (2-5 kişi)")
    print("   c) Büyük ekip (5+ kişi)")
    
    team_size = input("\nSeçim (a/b/c): ").strip().lower()
    
    # Recommendation Logic
    print("\n" + "="*50)
    print("📊 ANALİZ SONUÇLARI")
    print("="*50 + "\n")
    
    if project_size == 'a' and team_size == 'a':
        print("🎯 Önerilen Profil: **LITE MODE**")
        print("   Küçük, solo projeler için hafif yapılandırma.")
        print("\n📋 Başlangıç Komutu:")
        print("   echo 'MAESTRO_PROFILE=lite' > .maestro")
        print("   # Sonra doğrudan: /create komutunu kullan")
        
    elif project_type == 'c' or (project_size == 'c' and team_size in ['b', 'c']):
        print("🎯 Önerilen Profil: **FULL MAESTRO + BMAD**")
        print("   Enterprise düzey, derin planlama ve workflow yönetimi.")
        print("\n📋 Başlangıç Komutu:")
        print("   1. /create-prd-v2       # Gereksinim belgesi")
        print("   2. /create-architecture-v2  # Mimari tasarım")
        print("   3. /create-epics-v2     # Epic/Story breakdown")
        print("   4. /sprint-planning-v2  # Sprint başlat")
        
    else:
        print("🎯 Önerilen Profil: **STANDART MAESTRO**")
        print("   Dengeli yapılandırma. Orta ölçek projeler için ideal.")
        print("\n📋 Başlangıç Komutu:")
        print("   Basit özellikler için: /create")
        print("   Derin planlama gerekirse: /create-prd-v2")
    
    print("\n" + "="*50)
    print("💡 Detaylı bilgi için: USAGE_GUIDE.md veya QUICKSTART.md")
    print("="*50)

if __name__ == "__main__":
    main()
